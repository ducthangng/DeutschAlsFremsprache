package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/openai"
	"deutschfremsprache/internal/store"
	"deutschfremsprache/internal/topic"
)

const speechURLTTL = time.Hour

func textHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// voiceFor gives each dialogue speaker their own OpenAI voice.
func voiceFor(speakers []string, it *store.Item) string {
	return openai.VoiceFor(slices.Index(speakers, it.Speaker))
}

// ---- script generation ----

type generateRequest struct {
	Language   string   `json:"language"`
	SpeechType string   `json:"speechType"` // dialogue | monologue | vocabulary
	Scenario   string   `json:"scenario"`
	Vocabulary []string `json:"vocabulary"`
	Level      string   `json:"level"`
	Lines      int      `json:"lines"`
}

type generateResponse struct {
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	Kind         string            `json:"kind"`
	Content      string            `json:"content"` // editable topic source ("Speaker: text | nghĩa")
	Vocabulary   []vocabSuggestion `json:"vocabulary"`
	Usage        *openai.Usage     `json:"usage"`
	GenerationID int64             `json:"generationId"`
}

var levels = []string{"A1", "A2", "B1", "B2", "C1", "C2"}

func (in *generateRequest) validate() string {
	in.Scenario = strings.TrimSpace(in.Scenario)
	var vocab []string
	for _, v := range in.Vocabulary {
		if v = strings.TrimSpace(v); v != "" {
			vocab = append(vocab, v)
		}
	}
	in.Vocabulary = vocab
	switch {
	case !topic.Languages[in.Language]:
		return "ngôn ngữ không được hỗ trợ"
	case in.SpeechType != "dialogue" && in.SpeechType != "monologue" && in.SpeechType != "vocabulary":
		return "loại nội dung không hợp lệ"
	case in.Scenario == "" || utf8.RuneCountInString(in.Scenario) > 500:
		return "hãy mô tả tình huống (tối đa 500 ký tự)"
	case len(in.Vocabulary) > 30:
		return "tối đa 30 từ vựng"
	case !slices.Contains(levels, in.Level):
		return "trình độ không hợp lệ"
	case in.Lines < 4 || in.Lines > 30:
		return "số câu từ 4 đến 30"
	}
	for _, v := range in.Vocabulary {
		if utf8.RuneCountInString(v) > 80 {
			return "mỗi từ vựng tối đa 80 ký tự"
		}
	}
	return ""
}

// clean keeps generated text compatible with the "Speaker: text | note" format.
func clean(s string) string {
	s = strings.NewReplacer("|", "/", "\n", " ", "\r", " ").Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

func cleanSpeaker(s string) string {
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(":.?!,|", r) {
			return -1
		}
		return r
	}, clean(s))
	if utf8.RuneCountInString(s) > 24 {
		s = string([]rune(s)[:24])
	}
	return strings.TrimSpace(s)
}

func (s *Server) generateScript(w http.ResponseWriter, r *http.Request) {
	if !s.openai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "máy chủ chưa cấu hình OPENAI_API_KEY")
		return
	}
	var in generateRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	script, usage, err := s.openai.GenerateScript(ctx, openai.ScriptRequest{Language: in.Language, SpeechType: in.SpeechType,
		Scenario: in.Scenario, Vocabulary: in.Vocabulary, Level: in.Level, Lines: in.Lines})

	// Tokens are billed even when the answer is unusable, so log before checking err.
	var genID int64
	if usage != nil && usage.InputTokens+usage.OutputTokens > 0 {
		id, logErr := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "script", Model: usage.Model,
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, CostUSD: usage.CostUSD})
		if logErr != nil {
			log.Printf("log ai usage: %v", logErr)
		}
		genID = id
	}
	if err != nil {
		log.Printf("generate script: %v", err)
		writeError(w, http.StatusBadGateway, "không tạo được nội dung: "+err.Error())
		return
	}

	kind := topic.KindDialogue
	if in.SpeechType == "vocabulary" {
		kind = topic.KindVocabulary
	}
	var b strings.Builder
	for _, l := range script.Lines {
		text := clean(l.Text)
		if text == "" {
			continue
		}
		if sp := cleanSpeaker(l.Speaker); sp != "" && kind == topic.KindDialogue {
			b.WriteString(sp + ": ")
		}
		b.WriteString(text)
		if vi := clean(l.Vietnamese); vi != "" {
			b.WriteString(" | " + vi)
		}
		b.WriteByte('\n')
	}
	resp := generateResponse{Title: clean(script.Title), Description: clean(script.Description), Kind: kind, Content: b.String(), Usage: usage}
	for _, v := range script.Vocabulary {
		if t := clean(v.Term); t != "" {
			resp.Vocabulary = append(resp.Vocabulary, vocabSuggestion{Term: t, Meaning: clean(v.Vietnamese)})
		}
	}
	resp.GenerationID = genID
	writeJSON(w, http.StatusOK, resp)
}

// ---- generated reference speech ----

type speechResponse struct {
	URL        string  `json:"url"`
	Cached     bool    `json:"cached"` // true: loaded from storage, false: generated by this request
	Voice      string  `json:"voice"`
	DurationMs int     `json:"durationMs"`
	CostUSD    float64 `json:"costUsd"` // cost of this request (0 when cached)
	Storage    string  `json:"storage"` // s3 | local
}

// itemSpeech returns a playable URL for the item's reference audio,
// generating it with OpenAI TTS and storing it the first time.
func (s *Server) itemSpeech(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	item, t, err := s.store.GetItem(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if !s.ttsEnabled(t.Language) {
		writeError(w, http.StatusConflict, "giọng đọc tạo sẵn cần OPENAI_API_KEY trên máy chủ")
		return
	}
	items, err := s.store.ListItems(ctx, t.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	model, voice, hash := s.openai.TTSModel(), voiceFor(speakerOrder(items), item), textHash(item.Text)
	resp := speechResponse{Voice: voice, Storage: s.media.Name(), Cached: true}

	clip, err := s.store.GetTTSAudio(ctx, model, voice, hash)
	if errors.Is(err, store.ErrNotFound) {
		resp.Cached = false
		clip, resp.CostUSD, err = s.generateSpeech(r, uid, t, item.Text, model, voice, hash)
	}
	if err != nil {
		log.Printf("speech for item %d: %v", item.ID, err)
		writeError(w, http.StatusBadGateway, "không tạo được giọng đọc: "+err.Error())
		return
	}
	resp.DurationMs = clip.DurationMs
	if resp.URL, err = s.media.URL(ctx, clip.StorageKey, speechURLTTL); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// generateSpeech synthesizes, uploads and records one clip. Concurrent
// requests for the same clip share a single OpenAI call.
func (s *Server) generateSpeech(r *http.Request, uid int64, t *store.Topic, text, model, voice, hash string) (*store.TTSAudio, float64, error) {
	ctx := r.Context()
	type result struct {
		clip *store.TTSAudio
		cost float64
	}
	v, err, shared := s.ttsFlight.Do(model+"/"+voice+"/"+hash, func() (any, error) {
		sp, err := s.openai.Synthesize(ctx, t.Language, voice, text)
		if err != nil {
			return nil, err
		}
		key := fmt.Sprintf("tts/%s/%s/%s.wav", model, voice, hash)
		if err := s.media.Put(ctx, key, sp.WAV, "audio/wav"); err != nil {
			return nil, fmt.Errorf("upload: %w", err)
		}
		clip, created, err := s.store.SaveTTSAudio(ctx, uid, &store.TTSAudio{Model: model, Voice: voice, Language: t.Language, TextHash: hash,
			Text: text, StorageKey: key, ContentType: "audio/wav", Bytes: len(sp.WAV), DurationMs: sp.DurationMs, CostUSD: sp.CostUSD})
		if err != nil {
			return nil, err
		}
		if created {
			topicID := t.ID
			if _, err := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, TopicID: &topicID, Kind: "tts", Model: model,
				Chars: utf8.RuneCountInString(text), AudioMs: sp.DurationMs, CostUSD: sp.CostUSD}); err != nil {
				log.Printf("log tts usage: %v", err)
			}
		}
		return result{clip, sp.CostUSD}, nil
	})
	if err != nil {
		return nil, 0, err
	}
	res := v.(result)
	if shared {
		res.cost = 0 // several requests got this clip; the cost is logged once (in ai_usage), don't report it twice
	}
	return res.clip, res.cost, nil
}
