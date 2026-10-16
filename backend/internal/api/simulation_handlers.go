package api

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/openai"
	"deutschfremsprache/internal/speech"
	"deutschfremsprache/internal/store"
	"deutschfremsprache/internal/topic"
)

const simulationRounds = 10

// publicScenario hides the planned twist from the learner.
func publicScenario(raw json.RawMessage) json.RawMessage {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return raw
	}
	delete(m, "twist")
	out, _ := json.Marshal(m)
	return out
}

func scenarioOf(sim *store.Simulation) *openai.Scenario {
	var sc openai.Scenario
	json.Unmarshal(sim.Scenario, &sc)
	return &sc
}

func (s *Server) requireSimulations(w http.ResponseWriter) bool {
	if !s.openai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "mô phỏng cần OPENAI_API_KEY trên máy chủ")
		return false
	}
	return true
}

// logLLM records an OpenAI call against a simulation and returns its cost.
func (s *Server) logLLM(ctx context.Context, uid, simID int64, u *openai.Usage) float64 {
	if u == nil || u.InputTokens+u.OutputTokens == 0 {
		return 0
	}
	if _, err := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "simulation", Model: u.Model, InputTokens: u.InputTokens,
		OutputTokens: u.OutputTokens, CostUSD: u.CostUSD, SimulationID: &simID}); err != nil {
		log.Printf("log simulation usage: %v", err)
	}
	return u.CostUSD
}

type simulationDetail struct {
	*store.Simulation
	Turns []*store.SimulationTurn `json:"turns"`
	Costs *store.SimulationCosts  `json:"costs"`
	// VoiceGenerated is true when the partner's lines are voiced by OpenAI TTS.
	VoiceGenerated bool `json:"voiceGenerated"`
}

func (s *Server) writeSimulation(w http.ResponseWriter, r *http.Request, sim *store.Simulation, status int) {
	turns, err := s.store.SimulationTurns(r.Context(), sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	costs, err := s.store.SimulationCosts(r.Context(), sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	sim.Scenario = publicScenario(sim.Scenario)
	writeJSON(w, status, simulationDetail{Simulation: sim, Turns: turns, Costs: costs, VoiceGenerated: s.ttsEnabled(sim.Language)})
}

func (s *Server) listSimulations(w http.ResponseWriter, r *http.Request) {
	sims, err := s.store.ListSimulations(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for _, sim := range sims {
		sim.Scenario = publicScenario(sim.Scenario)
	}
	writeJSON(w, http.StatusOK, sims)
}

func (s *Server) getSimulation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	sim, err := s.store.GetSimulation(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.writeSimulation(w, r, sim, http.StatusOK)
}

// createSimulation invents a scenario from the learner's history and opens the conversation.
func (s *Server) createSimulation(w http.ResponseWriter, r *http.Request) {
	if !s.requireSimulations(w) {
		return
	}
	var in struct {
		Language string `json:"language"`
		Level    string `json:"level"`
		Hint     string `json:"hint"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Hint = strings.TrimSpace(in.Hint)
	if !topic.Languages[in.Language] || !slices.Contains(levels, in.Level) || utf8.RuneCountInString(in.Hint) > 300 {
		writeError(w, http.StatusBadRequest, "ngôn ngữ, trình độ hoặc gợi ý không hợp lệ")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())

	req := openai.ScenarioRequest{Language: in.Language, Level: in.Level, Hint: in.Hint}
	if req.Topics, _ = s.store.RecentTopicTitles(ctx, uid, in.Language); len(req.Topics) > 8 {
		req.Topics = req.Topics[:8]
	}
	if cards, err := s.store.ListVocab(ctx, uid); err == nil {
		// Prefer words still being learned; shuffle for variety.
		rand.Shuffle(len(cards), func(i, j int) { cards[i], cards[j] = cards[j], cards[i] })
		slices.SortStableFunc(cards, func(a, b *store.VocabEntry) int { return int(a.Interval - b.Interval) })
		for _, c := range cards {
			if c.Language == in.Language && len(req.Vocabulary) < 15 {
				req.Vocabulary = append(req.Vocabulary, c.Term)
			}
		}
	}
	if past, err := s.store.ListSimulations(ctx, uid); err == nil {
		for _, p := range past[:min(5, len(past))] {
			req.Avoid = append(req.Avoid, scenarioOf(p).Title)
		}
	}

	sc, usage, err := s.openai.GenerateScenario(ctx, req)
	if err != nil {
		s.logLLMWithoutSimulation(ctx, uid, usage)
		log.Printf("generate scenario: %v", err)
		writeError(w, http.StatusBadGateway, "không tạo được tình huống: "+err.Error())
		return
	}
	raw, _ := json.Marshal(sc)
	sim, err := s.store.CreateSimulation(ctx, uid, in.Language, in.Level, raw, simulationRounds)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	cost := s.logLLM(ctx, uid, sim.ID, usage)
	if _, err := s.store.AddSimulationTurn(ctx, sim.ID, &store.SimulationTurn{Round: 0, Speaker: "ai", Text: sc.Opening, Transl: sc.OpeningVi, CostUSD: cost}); err != nil {
		writeStoreError(w, err)
		return
	}
	s.writeSimulation(w, r, sim, http.StatusCreated)
}

func (s *Server) logLLMWithoutSimulation(ctx context.Context, uid int64, u *openai.Usage) {
	if u != nil && u.InputTokens+u.OutputTokens > 0 {
		s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "simulation", Model: u.Model, InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, CostUSD: u.CostUSD})
	}
}

func history(turns []*store.SimulationTurn) []openai.Message {
	out := make([]openai.Message, len(turns))
	for i, t := range turns {
		out[i] = openai.Message{Speaker: t.Speaker, Text: t.Text}
	}
	return out
}

// userEvaluation is what is stored (and shown) for a learner's turn.
type userEvaluation struct {
	Feedback    string             `json:"feedback"`
	Corrected   string             `json:"corrected"`
	GrammarNote string             `json:"grammarNote"`
	Understood  bool               `json:"understood"`
	Words       []speech.Token     `json:"words,omitempty"` // pronunciation per word
	Cost        map[string]float64 `json:"cost"`            // speech / llm breakdown, USD
}

// addSimulationTurn takes the learner's spoken (multipart "audio") or typed
// ("text") message, grades it and lets the partner answer.
func (s *Server) addSimulationTurn(w http.ResponseWriter, r *http.Request) {
	if !s.requireSimulations(w) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	sim, err := s.store.GetSimulation(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if sim.Status != "active" {
		writeError(w, http.StatusConflict, "mô phỏng đã kết thúc")
		return
	}
	turns, err := s.store.SimulationTurns(ctx, sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	round := 1
	for _, t := range turns {
		if t.Speaker == "user" {
			round++
		}
	}
	if round > sim.MaxRounds {
		writeError(w, http.StatusConflict, "đã hết lượt")
		return
	}

	userTurn := &store.SimulationTurn{Round: round, Speaker: "user"}
	eval := userEvaluation{Cost: map[string]float64{}}
	r.Body = http.MaxBytesReader(w, r.Body, maxAudioBytes+1<<16)
	if err := r.ParseMultipartForm(maxAudioBytes); err != nil {
		writeError(w, http.StatusBadRequest, "dữ liệu không hợp lệ")
		return
	}
	if text := strings.TrimSpace(r.FormValue("text")); text != "" {
		if utf8.RuneCountInString(text) > 500 {
			writeError(w, http.StatusBadRequest, "tối đa 500 ký tự")
			return
		}
		userTurn.Text, userTurn.Typed = text, true
	} else {
		if !s.speech.Enabled() {
			writeError(w, http.StatusConflict, "chưa cấu hình Azure Speech: hãy gõ câu trả lời")
			return
		}
		wav, err := readWAVUpload(w, r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if !s.transcribeAndGrade(r, uid, sim, round, wav, userTurn, &eval) {
			writeError(w, http.StatusUnprocessableEntity, "không nghe rõ bạn nói gì, hãy thử lại")
			return
		}
	}

	sc := scenarioOf(sim)
	e, usage, err := s.openai.EvaluateTurn(ctx, sim.Language, sim.Level, sc, history(turns), userTurn.Text, round, sim.MaxRounds)
	eval.Cost["llm"] = s.logLLM(ctx, uid, sim.ID, usage)
	if err != nil {
		log.Printf("evaluate turn: %v", err)
		writeError(w, http.StatusBadGateway, "không chấm được câu trả lời: "+err.Error())
		return
	}
	eval.Feedback, eval.Corrected, eval.GrammarNote, eval.Understood = e.Feedback, e.Corrected, e.GrammarNote, e.Understood
	logic := min(max(e.LogicScore, 0), 100)
	userTurn.LogicScore = &logic
	userTurn.Evaluation, _ = json.Marshal(eval)
	for _, c := range eval.Cost {
		userTurn.CostUSD += c
	}

	if _, err = s.store.AddSimulationTurn(ctx, sim.ID, userTurn); err != nil {
		writeStoreError(w, err)
		return
	}
	if _, err = s.store.AddSimulationTurn(ctx, sim.ID, &store.SimulationTurn{Round: round, Speaker: "ai", Text: e.Reply, Transl: e.ReplyVi}); err != nil {
		writeStoreError(w, err)
		return
	}
	if e.End || round >= sim.MaxRounds {
		s.finalizeSimulation(ctx, uid, sim)
	}
	sim, err = s.store.GetSimulation(ctx, uid, sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.writeSimulation(w, r, sim, http.StatusOK)
}

// transcribeAndGrade fills the turn with what the learner said and how it
// sounded. It returns false if nothing intelligible was recognized.
func (s *Server) transcribeAndGrade(r *http.Request, uid int64, sim *store.Simulation, round int, wav []byte, t *store.SimulationTurn, eval *userEvaluation) bool {
	ctx := r.Context()
	audioMs := wavDurationMs(wav)
	start := time.Now()
	text, err := s.speech.Transcribe(ctx, sim.Language, wav)
	sttCost := float64(audioMs) / 3_600_000 * s.cfg.AzureSTTUSDPerHour
	s.store.LogAssessment(ctx, store.Assessment{UserID: uid, Provider: "azure-stt", AudioMs: audioMs, LatencyMs: int(time.Since(start).Milliseconds()),
		CostUSD: sttCost, SimulationID: &sim.ID})
	eval.Cost["transcription"] = sttCost
	if err != nil || strings.TrimSpace(text) == "" {
		if err != nil {
			log.Printf("transcribe: %v", err)
		}
		return false
	}
	t.Text = text

	start = time.Now()
	a, err := s.speech.Assess(ctx, sim.Language, text, wav)
	paCost := float64(audioMs) / 3_600_000 * s.cfg.AssessUSDPerHour
	eval.Cost["pronunciation"] = paCost
	if err != nil {
		log.Printf("assess simulation turn: %v", err) // keep the turn; just without pronunciation scores
	} else {
		pron, acc, flu := a.PronScore, a.AccuracyScore, a.FluencyScore
		t.PronScore, t.Accuracy, t.Fluency = &pron, &acc, &flu
		eval.Words = speech.Align(text, a.Words, s.cfg.WordThreshold)
		s.store.LogAssessment(ctx, store.Assessment{UserID: uid, Provider: "azure", AudioMs: audioMs, LatencyMs: int(time.Since(start).Milliseconds()),
			PronScore: pron, Passed: pron >= s.cfg.PassThreshold, CostUSD: paCost, SimulationID: &sim.ID})
	}

	var rnd [8]byte
	crand.Read(rnd[:])
	key := fmt.Sprintf("simulations/u%d/s%d/r%02d-%s.wav", uid, sim.ID, round, hex.EncodeToString(rnd[:]))
	if err := s.media.Put(ctx, key, wav, "audio/wav"); err != nil {
		log.Printf("store simulation audio: %v", err)
	} else {
		t.AudioKey = key
	}
	return true
}

// finalizeSimulation writes the overall evaluation and closes the simulation.
func (s *Server) finalizeSimulation(ctx context.Context, uid int64, sim *store.Simulation) {
	turns, err := s.store.SimulationTurns(ctx, sim.ID)
	if err != nil {
		log.Printf("finalize simulation: %v", err)
		return
	}
	var pronSum, logicSum float64
	var pronN, logicN, rounds int
	for _, t := range turns {
		if t.Speaker != "user" {
			continue
		}
		rounds++
		if t.PronScore != nil {
			pronSum += *t.PronScore
			pronN++
		}
		if t.LogicScore != nil {
			logicSum += *t.LogicScore
			logicN++
		}
	}
	avg := func(sum float64, n int) *float64 {
		if n == 0 {
			return nil
		}
		v := float64(int(sum/float64(n)*10)) / 10
		return &v
	}
	summary := map[string]any{"rounds": rounds, "avgPron": avg(pronSum, pronN), "avgLogic": avg(logicSum, logicN),
		"durationSec": int(time.Since(sim.CreatedAt).Seconds())}
	if rounds > 0 {
		var p float64
		if a := avg(pronSum, pronN); a != nil {
			p = *a
		}
		sum, usage, err := s.openai.Summarize(ctx, sim.Language, sim.Level, scenarioOf(sim), history(turns), p)
		summary["costUsd"] = s.logLLM(ctx, uid, sim.ID, usage)
		if err != nil {
			log.Printf("summarize simulation: %v", err)
		} else {
			b, _ := json.Marshal(sum)
			json.Unmarshal(b, &summary)
		}
	}
	raw, _ := json.Marshal(summary)
	if err := s.store.FinishSimulation(ctx, uid, sim.ID, raw); err != nil {
		log.Printf("finish simulation: %v", err)
	}
}

func (s *Server) finishSimulation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	sim, err := s.store.GetSimulation(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if sim.Status == "active" {
		s.finalizeSimulation(ctx, uid, sim)
		if sim, err = s.store.GetSimulation(ctx, uid, id); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	s.writeSimulation(w, r, sim, http.StatusOK)
}

// turnSpeech returns a playable URL for a turn: the learner's recording, or
// the partner's line voiced by OpenAI TTS (generated once, then stored).
func (s *Server) turnSpeech(w http.ResponseWriter, r *http.Request) {
	turnID, err := strconv.ParseInt(r.PathValue("turnId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "id không hợp lệ")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	t, simID, err := s.store.GetSimulationTurn(ctx, uid, turnID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	resp := speechResponse{Cached: true, Storage: s.media.Name()}
	if t.AudioKey == "" {
		sim, err := s.store.GetSimulation(ctx, uid, simID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if t.Speaker != "ai" || !s.ttsEnabled(sim.Language) {
			writeError(w, http.StatusConflict, "không có giọng đọc tạo sẵn cho lượt này")
			return
		}
		voice := openai.VoiceFor(int(simID % int64(len(openai.Voices))))
		sp, err := s.openai.Synthesize(ctx, sim.Language, voice, t.Text)
		if err != nil {
			writeError(w, http.StatusBadGateway, "không tạo được giọng đọc: "+err.Error())
			return
		}
		key := fmt.Sprintf("simulations/u%d/s%d/t%d-ai.wav", uid, simID, t.ID)
		if err := s.media.Put(ctx, key, sp.WAV, "audio/wav"); err != nil {
			writeError(w, http.StatusBadGateway, "không lưu được giọng đọc")
			return
		}
		s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "tts", Model: s.openai.TTSModel(), Chars: utf8.RuneCountInString(t.Text),
			AudioMs: sp.DurationMs, CostUSD: sp.CostUSD, SimulationID: &simID})
		s.store.SetTurnAudio(ctx, t.ID, key, sp.CostUSD)
		t.AudioKey, resp.Cached, resp.CostUSD, resp.Voice, resp.DurationMs = key, false, sp.CostUSD, voice, sp.DurationMs
	}
	// A time-limited signed URL (presigned on S3): <audio> cannot send auth headers.
	if resp.URL, err = s.media.URL(ctx, t.AudioKey, speechURLTTL); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
