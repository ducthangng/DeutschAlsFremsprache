package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/openai"
	"deutschfremsprache/internal/speech"
	"deutschfremsprache/internal/store"
)

// Question count limits per section.
var grammarLimits = openai.GrammarSections{MultipleChoice: 30, Rearrange: 30, Reading: 15, Listening: 15, Writing: 20}

const maxGeneratingGrammar = 2 // per user at a time

func (s *Server) grammarModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"models":         openai.GrammarModels,
		"defaultModel":   openai.GrammarModels[0].ID,
		"limits":         grammarLimits,
		"enabled":        s.openai.Enabled(),
		"listeningAudio": s.speech.Enabled(), // otherwise the browser reads the script aloud
	})
}

func (s *Server) listGrammarSets(w http.ResponseWriter, r *http.Request) {
	sets, err := s.store.ListGrammarSets(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sets)
}

func (s *Server) writeGrammarSet(w http.ResponseWriter, r *http.Request, g *store.GrammarSet, status int) {
	if g.AudioKey != "" {
		if u, err := s.media.URL(r.Context(), g.AudioKey, speechURLTTL); err == nil {
			g.AudioURL = u
		} else {
			log.Printf("grammar %d audio url: %v", g.ID, err)
		}
	}
	writeJSON(w, status, g)
}

func (s *Server) getGrammarSet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	g, err := s.store.GetGrammarSet(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.writeGrammarSet(w, r, g, http.StatusOK)
}

// createGrammarSet stores the request and generates the exercises in the
// background; the browser polls the set until its status leaves "generating".
func (s *Server) createGrammarSet(w http.ResponseWriter, r *http.Request) {
	if !s.openai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "bài ngữ pháp cần OPENAI_API_KEY trên máy chủ")
		return
	}
	var in struct {
		Grammar  string                 `json:"grammar"`
		Level    string                 `json:"level"`
		Model    string                 `json:"model"`
		Sections openai.GrammarSections `json:"sections"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Grammar = strings.TrimSpace(in.Grammar)
	m, okModel := openai.GrammarModel(in.Model)
	sec, lim := in.Sections, grammarLimits
	inRange := func(n, max int) bool { return n >= 0 && n <= max }
	switch {
	case utf8.RuneCountInString(in.Grammar) < 2 || utf8.RuneCountInString(in.Grammar) > 200:
		writeError(w, http.StatusBadRequest, "chủ điểm ngữ pháp cần từ 2 đến 200 ký tự")
		return
	case !slices.Contains(levels, in.Level):
		writeError(w, http.StatusBadRequest, "trình độ không hợp lệ")
		return
	case !okModel:
		writeError(w, http.StatusBadRequest, "model không được hỗ trợ")
		return
	case !inRange(sec.MultipleChoice, lim.MultipleChoice) || !inRange(sec.Rearrange, lim.Rearrange) || !inRange(sec.Reading, lim.Reading) ||
		!inRange(sec.Listening, lim.Listening) || !inRange(sec.Writing, lim.Writing):
		writeError(w, http.StatusBadRequest, "số câu hỏi vượt giới hạn")
		return
	case sec.MultipleChoice+sec.Rearrange+sec.Reading+sec.Listening+sec.Writing == 0:
		writeError(w, http.StatusBadRequest, "hãy chọn ít nhất một dạng bài")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if sets, err := s.store.ListGrammarSets(ctx, uid); err == nil {
		busy := 0
		for _, g := range sets {
			if g.Status == "generating" {
				busy++
			}
		}
		if busy >= maxGeneratingGrammar {
			writeError(w, http.StatusTooManyRequests, "đang tạo bài khác, hãy đợi bài đó xong")
			return
		}
	}
	sections, _ := json.Marshal(sec)
	g, err := s.store.CreateGrammarSet(ctx, uid, in.Grammar, in.Level, m.ID, sections)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	go s.generateGrammar(uid, g.ID, m, openai.GrammarRequest{Grammar: in.Grammar, Level: in.Level, Sections: sec})
	s.writeGrammarSet(w, r, g, http.StatusCreated)
}

// generateGrammar writes every requested section in parallel (one retry
// each), voices the listening script, and stores the result. Sections that
// still fail are reported in content.errors; the set fails only if nothing
// could be generated.
func (s *Server) generateGrammar(uid, id int64, m openai.Model, req openai.GrammarRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	var (
		mu      sync.Mutex
		cost    float64
		wg      sync.WaitGroup
		content = openai.GrammarContent{Errors: map[string]string{}}
	)
	logUsage := func(u *openai.Usage) {
		if u == nil || u.InputTokens+u.OutputTokens == 0 {
			return
		}
		if _, err := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "grammar", Model: u.Model, InputTokens: u.InputTokens,
			OutputTokens: u.OutputTokens, CostUSD: u.CostUSD, GrammarSetID: &id}); err != nil {
			log.Printf("log grammar usage: %v", err)
		}
		mu.Lock()
		cost += u.CostUSD
		mu.Unlock()
	}
	// Each section writes only its own field of content; Errors is shared.
	run := func(section string, want bool, gen func() (*openai.Usage, error)) {
		if !want {
			return
		}
		wg.Go(func() {
			var err error
			for range 2 {
				var u *openai.Usage
				u, err = gen()
				logUsage(u)
				if err == nil {
					return
				}
				log.Printf("grammar %d %s: %v", id, section, err)
			}
			mu.Lock()
			content.Errors[section] = "không tạo được phần này: " + err.Error()
			mu.Unlock()
		})
	}
	sec := req.Sections
	core := "multipleChoice"
	if sec.MultipleChoice == 0 {
		core = "overview" // title and explanation only
	}
	run(core, true, func() (u *openai.Usage, err error) {
		content.Title, content.Overview, content.MultipleChoice, u, err = s.openai.GrammarCore(ctx, m, req)
		return
	})
	run("rearrange", sec.Rearrange > 0, func() (u *openai.Usage, err error) {
		content.Rearrange, u, err = s.openai.GrammarRearrange(ctx, m, req)
		return
	})
	run("reading", sec.Reading > 0, func() (u *openai.Usage, err error) {
		content.Reading, u, err = s.openai.GrammarReading(ctx, m, req)
		return
	})
	run("listening", sec.Listening > 0, func() (u *openai.Usage, err error) {
		content.Listening, u, err = s.openai.GrammarListening(ctx, m, req)
		return
	})
	run("writing", sec.Writing > 0, func() (u *openai.Usage, err error) {
		content.Writing, u, err = s.openai.GrammarWriting(ctx, m, req)
		return
	})
	wg.Wait()

	audioKey := ""
	if content.Listening != nil && s.speech.Enabled() {
		key, ttsCost, err := s.listeningAudio(ctx, uid, id, content.Listening)
		if err != nil {
			log.Printf("grammar %d listening audio: %v", id, err)
			content.Errors["listeningAudio"] = "không tạo được audio, trình duyệt sẽ đọc thay"
		}
		audioKey, cost = key, cost+ttsCost
	}

	if content.Title == "" {
		content.Title = req.Grammar
	}
	if content.MultipleChoice == nil {
		content.MultipleChoice = []openai.ChoiceQuestion{}
	}
	if content.Rearrange == nil {
		content.Rearrange = []openai.RearrangeQuestion{}
	}
	if content.Writing == nil {
		content.Writing = []openai.WritingTask{}
	}
	if len(content.Errors) == 0 {
		content.Errors = nil
	}
	status, errMsg := "ready", ""
	if len(content.MultipleChoice)+len(content.Rearrange)+len(content.Writing) == 0 && content.Reading == nil && content.Listening == nil {
		status, errMsg = "failed", "không tạo được bài tập, hãy thử lại hoặc chọn model khác"
		for _, e := range content.Errors {
			errMsg = e
			break
		}
	}
	raw, _ := json.Marshal(content)
	if err := s.store.FinishGrammarSet(ctx, id, status, errMsg, raw, audioKey, cost); err != nil {
		log.Printf("grammar %d save: %v", id, err)
	}
}

// listeningAudio renders the script with Azure neural voices (one per
// speaker) and keeps the MP3 in media storage. The same script is only ever
// synthesized once: clips are shared through the tts_audio cache.
func (s *Server) listeningAudio(ctx context.Context, uid, setID int64, l *openai.Listening) (string, float64, error) {
	type voice struct {
		gender string
		n      int
	}
	voices := map[string]voice{}
	perGender := map[string]int{}
	for _, sp := range l.Speakers {
		g := sp.Gender
		if g != "male" {
			g = "female"
		}
		voices[sp.Name] = voice{g, perGender[g]}
		perGender[g]++
	}
	var (
		lines []speech.Line
		text  strings.Builder
	)
	for _, seg := range l.Segments {
		v, ok := voices[seg.Speaker]
		if !ok {
			v = voice{"female", 0}
		}
		lines = append(lines, speech.Line{Gender: v.gender, Voice: v.n, Text: seg.Text})
		if seg.Speaker != "" {
			text.WriteString(seg.Speaker + ": ")
		}
		text.WriteString(seg.Text + "\n")
	}
	ssml := speech.SSML("de-DE", lines)
	sum := sha256.Sum256([]byte(ssml))
	hash := hex.EncodeToString(sum[:])
	const voiceName = "ssml"

	if a, err := s.store.GetTTSAudio(ctx, speech.TTSModel, voiceName, hash); err == nil {
		return a.StorageKey, 0, nil
	}
	syn, err := s.speech.Synthesize(ctx, ssml)
	if err != nil {
		return "", 0, err
	}
	chars := 0
	for _, ln := range lines {
		chars += utf8.RuneCountInString(ln.Text)
	}
	cost := float64(chars) / 1e6 * s.cfg.AzureTTSUSDPerMChars
	key := "tts/azure/" + hash + ".mp3"
	if err := s.media.Put(ctx, key, syn.MP3, "audio/mpeg"); err != nil {
		return "", 0, err
	}
	a, created, err := s.store.SaveTTSAudio(ctx, uid, &store.TTSAudio{Model: speech.TTSModel, Voice: voiceName, Language: "de-DE", TextHash: hash,
		Text: text.String(), StorageKey: key, ContentType: "audio/mpeg", Bytes: len(syn.MP3), DurationMs: syn.DurationMs, CostUSD: cost})
	if err != nil {
		return "", 0, err
	}
	if !created {
		return a.StorageKey, 0, nil
	}
	if _, err := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "tts", Model: speech.TTSModel, Chars: chars, AudioMs: syn.DurationMs,
		CostUSD: cost, GrammarSetID: &setID}); err != nil {
		log.Printf("log listening tts: %v", err)
	}
	return key, cost, nil
}

// saveGrammarAnswers keeps the learner's latest answers so a set can be resumed.
func (s *Server) saveGrammarAnswers(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Answers json.RawMessage `json:"answers"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Answers) == 0 || in.Answers[0] != '{' || len(in.Answers) > 256<<10 {
		writeError(w, http.StatusBadRequest, "câu trả lời không hợp lệ")
		return
	}
	if err := s.store.SaveGrammarAnswers(r.Context(), auth.UserID(r.Context()), id, in.Answers); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// gradeGrammarWriting has the set's model mark the learner's translations.
func (s *Server) gradeGrammarWriting(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if !s.openai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "chấm bài cần OPENAI_API_KEY trên máy chủ")
		return
	}
	var in struct {
		Answers []string `json:"answers"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	g, err := s.store.GetGrammarSet(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	var content openai.GrammarContent
	if g.Status != "ready" || json.Unmarshal(g.Content, &content) != nil || len(content.Writing) == 0 {
		writeError(w, http.StatusConflict, "bài này không có phần viết")
		return
	}
	if len(in.Answers) != len(content.Writing) {
		writeError(w, http.StatusBadRequest, "số câu trả lời không khớp")
		return
	}
	answers := make([]openai.WritingAnswer, len(in.Answers))
	for i, a := range in.Answers {
		a = strings.TrimSpace(a)
		if utf8.RuneCountInString(a) > 500 {
			writeError(w, http.StatusBadRequest, "câu trả lời quá dài")
			return
		}
		in.Answers[i] = a
		answers[i] = openai.WritingAnswer{English: content.Writing[i].English, Reference: content.Writing[i].German, Answer: a}
	}
	m, ok := openai.GrammarModel(g.Model)
	if !ok {
		m = openai.GrammarModels[0]
	}
	items, u, err := s.openai.GradeWriting(ctx, m, g.Grammar, g.Level, answers)
	var cost float64
	if u != nil && u.InputTokens+u.OutputTokens > 0 {
		cost = u.CostUSD
		if _, lerr := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "grammar", Model: u.Model, InputTokens: u.InputTokens,
			OutputTokens: u.OutputTokens, CostUSD: u.CostUSD, GrammarSetID: &id}); lerr != nil {
			log.Printf("log grammar grading: %v", lerr)
		}
	}
	if err != nil {
		log.Printf("grammar %d grade writing: %v", id, err)
		if cost > 0 {
			s.store.SaveGrammarWritingFeedback(ctx, uid, id, g.WritingFeedback, cost) // keep the cost, not a result
		}
		writeError(w, http.StatusBadGateway, "không chấm được bài viết, vui lòng thử lại")
		return
	}
	feedback, _ := json.Marshal(map[string]any{"answers": in.Answers, "items": items})
	if err := s.store.SaveGrammarWritingFeedback(ctx, uid, id, feedback, cost); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"writingFeedback": json.RawMessage(feedback), "costUsd": cost})
}

func (s *Server) deleteGrammarSet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteGrammarSet(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
