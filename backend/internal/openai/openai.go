// Package openai calls the OpenAI API to generate practice scripts (Chat
// Completions with a strict JSON schema) and reference speech (audio/speech).
package openai

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	APIKey  string
	BaseURL string // default https://api.openai.com/v1

	ChatModel             string
	ChatUSDPerMInput      float64 // per 1M input tokens
	ChatUSDPerMOutput     float64 // per 1M output tokens
	TTSModel              string
	TTSUSDPerMinute       float64 // estimate for token-billed models (gpt-4o-mini-tts)
	TTSUSDPerMillionChars float64 // for character-billed models (tts-1, tts-1-hd)
}

type Client struct {
	cfg  Config
	http *http.Client
}

func New(cfg Config) *Client {
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	return &Client{cfg: cfg, http: &http.Client{Timeout: 90 * time.Second}}
}

func (c *Client) Enabled() bool     { return c != nil && c.cfg.APIKey != "" }
func (c *Client) ChatModel() string { return c.cfg.ChatModel }
func (c *Client) TTSModel() string  { return c.cfg.TTSModel }

// Voices for reference speech (German and English); dialogue speakers get them in order.
var Voices = []string{"coral", "onyx", "nova", "ash", "sage", "ballad"}

// VoiceFor picks the voice of the n-th speaker (n = -1 for narration).
func VoiceFor(n int) string {
	if n < 0 {
		n = 0
	}
	return Voices[n%len(Voices)]
}

// ---- script generation ----

type ScriptRequest struct {
	Language   string   // de-DE | en-US
	SpeechType string   // dialogue | monologue | vocabulary
	Scenario   string   // e.g. "Am Bahnhof: Fahrkarte kaufen"
	Vocabulary []string // terms that must appear
	Level      string   // A1..C2
	Lines      int
}

type ScriptLine struct {
	Speaker    string `json:"speaker"`
	Text       string `json:"text"`
	Vietnamese string `json:"vietnamese"`
}

type VocabItem struct {
	Term       string `json:"term"`
	Vietnamese string `json:"vietnamese"`
}

type Script struct {
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Lines       []ScriptLine `json:"lines"`
	Vocabulary  []VocabItem  `json:"vocabulary"`
}

type Usage struct {
	Model        string  `json:"model"`
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	CostUSD      float64 `json:"costUsd"`
}

var scriptSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"title", "description", "lines", "vocabulary"},
	"properties": map[string]any{
		"title":       map[string]any{"type": "string", "description": "Short title in the target language"},
		"description": map[string]any{"type": "string", "description": "One sentence in Vietnamese describing the situation"},
		"lines": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"speaker", "text", "vietnamese"},
				"properties": map[string]any{
					"speaker":    map[string]any{"type": "string", "description": "Speaker first name; empty string for monologue or vocabulary lists"},
					"text":       map[string]any{"type": "string"},
					"vietnamese": map[string]any{"type": "string", "description": "Natural Vietnamese translation of text"},
				},
			},
		},
		"vocabulary": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"term", "vietnamese"},
				"properties": map[string]any{
					"term":       map[string]any{"type": "string", "description": "Dictionary form; German nouns with article"},
					"vietnamese": map[string]any{"type": "string"},
				},
			},
		},
	},
}

func scriptPrompt(r ScriptRequest) string {
	lang := map[string]string{"de-DE": "German (standard Hochdeutsch)", "en-US": "American English"}[r.Language]
	var b strings.Builder
	fmt.Fprintf(&b, "Write a pronunciation-practice script in %s for a Vietnamese learner at CEFR level %s.\n", lang, r.Level)
	fmt.Fprintf(&b, "Scenario: %s\n", r.Scenario)
	switch r.SpeechType {
	case "dialogue":
		fmt.Fprintf(&b, "Format: a natural conversation between exactly 2 people with typical first names for the language, alternating turns, about %d lines.\n", r.Lines)
	case "monologue":
		fmt.Fprintf(&b, "Format: one person speaking (a short story, announcement or explanation), about %d sentences. Leave speaker empty.\n", r.Lines)
	default:
		fmt.Fprintf(&b, "Format: a vocabulary drill of about %d lines. Each line is either a single term (German nouns with article) or a short example sentence using a term. Leave speaker empty.\n", r.Lines)
	}
	if len(r.Vocabulary) > 0 {
		fmt.Fprintf(&b, "Use every one of these terms naturally at least once: %s\n", strings.Join(r.Vocabulary, "; "))
		b.WriteString("In \"vocabulary\" list exactly these terms (dictionary form) with their Vietnamese meaning.\n")
	} else {
		b.WriteString("In \"vocabulary\" list 5-8 useful key terms from the script with their Vietnamese meaning.\n")
	}
	b.WriteString("Rules: each line at most 20 words; everyday, correct, idiomatic language; no stage directions, no quotes, no numbering. " +
		"\"vietnamese\" is a natural translation, not word-by-word. \"title\" is in the target language, \"description\" in Vietnamese.")
	return b.String()
}

// GenerateScript asks the chat model for a structured practice script.
func (c *Client) GenerateScript(ctx context.Context, r ScriptRequest) (*Script, *Usage, error) {
	var sc Script
	u, err := c.chatJSON(ctx, "You are an experienced language teacher who writes short, realistic speaking-practice material.",
		scriptPrompt(r), "practice_script", scriptSchema, 0.8, &sc)
	if err != nil {
		return nil, u, err
	}
	return &sc, u, nil
}

// ---- speech ----

const pcmRate = 24000 // OpenAI "pcm" output: 24 kHz, 16-bit, mono, little-endian

type Speech struct {
	WAV        []byte
	DurationMs int
	CostUSD    float64
}

// Synthesize renders text with the configured TTS model and returns a WAV.
func (c *Client) Synthesize(ctx context.Context, language, voice, text string) (*Speech, error) {
	body := map[string]any{
		"model":           c.cfg.TTSModel,
		"voice":           voice,
		"input":           text,
		"response_format": "pcm",
	}
	if !strings.HasPrefix(c.cfg.TTSModel, "tts-1") { // only newer models accept instructions
		lang := map[string]string{"de-DE": "standard German (Hochdeutsch)", "en-US": "American English"}[language]
		body["instructions"] = "Speak in clear, natural " + lang + " with accurate pronunciation, at a calm pace suitable for language learners to repeat."
	}
	pcm, err := c.post(ctx, "/audio/speech", body)
	if err != nil {
		return nil, err
	}
	if len(pcm) < 2 {
		return nil, errors.New("openai returned empty audio")
	}
	sp := &Speech{WAV: wavFromPCM(pcm, pcmRate), DurationMs: len(pcm) / 2 * 1000 / pcmRate}
	if strings.HasPrefix(c.cfg.TTSModel, "tts-1") {
		sp.CostUSD = float64(len([]rune(text))) / 1e6 * c.cfg.TTSUSDPerMillionChars
	} else {
		sp.CostUSD = float64(sp.DurationMs) / 60000 * c.cfg.TTSUSDPerMinute
	}
	return sp, nil
}

func wavFromPCM(pcm []byte, rate int) []byte {
	pcm = pcm[:len(pcm)&^1]
	var b bytes.Buffer
	b.Grow(44 + len(pcm))
	w := func(v any) { binary.Write(&b, binary.LittleEndian, v) }
	b.WriteString("RIFF")
	w(uint32(36 + len(pcm)))
	b.WriteString("WAVEfmt ")
	w(uint32(16))
	w(uint16(1)) // PCM
	w(uint16(1)) // mono
	w(uint32(rate))
	w(uint32(rate * 2))
	w(uint16(2))
	w(uint16(16))
	b.WriteString("data")
	w(uint32(len(pcm)))
	b.Write(pcm)
	return b.Bytes()
}

func (c *Client) post(ctx context.Context, path string, body any) ([]byte, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error struct{ Message string }
		}
		json.Unmarshal(raw, &e)
		if e.Error.Message == "" {
			e.Error.Message = strings.TrimSpace(string(raw))
		}
		return nil, fmt.Errorf("openai %s: %d %s", path, resp.StatusCode, e.Error.Message)
	}
	return raw, nil
}
