package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
)

// AIUsage is one paid OpenAI call.
type AIUsage struct {
	UserID       int64
	TopicID      *int64
	Kind         string // script | tts
	Model        string
	InputTokens  int
	OutputTokens int
	Chars        int
	AudioMs      int
	CostUSD      float64
	SimulationID *int64
}

// LogAIUsage records a call and returns its id (used to link a script
// generation to the topic created from it).
func (s *Store) LogAIUsage(ctx context.Context, u AIUsage) (int64, error) {
	return s.q.CreateAIUsage(ctx, gen.CreateAIUsageParams{UserID: u.UserID, TopicID: optInt8(u.TopicID), Kind: u.Kind, Model: u.Model,
		InputTokens: int32(u.InputTokens), OutputTokens: int32(u.OutputTokens), Chars: int32(u.Chars), AudioMs: int32(u.AudioMs), CostUsd: u.CostUSD,
		SimulationID: optInt8(u.SimulationID)})
}

type AIUsagePeriod struct {
	Scripts       int     `json:"scripts"`
	ScriptCostUSD float64 `json:"scriptCostUsd"`
	TTSClips      int     `json:"ttsClips"`
	TTSAudioSec   float64 `json:"ttsAudioSeconds"`
	TTSCostUSD    float64 `json:"ttsCostUsd"`
	Images        int     `json:"images"`
	ImageCostUSD  float64 `json:"imageCostUsd"`
	SimulationUSD float64 `json:"simulationCostUsd"` // LLM calls of simulations
}

func (s *Store) AIUsageSince(ctx context.Context, userID int64, since time.Time) (*AIUsagePeriod, error) {
	r, err := s.q.AIUsageSummary(ctx, gen.AIUsageSummaryParams{UserID: userID, Since: since})
	if err != nil {
		return nil, err
	}
	return &AIUsagePeriod{Scripts: int(r.Scripts), ScriptCostUSD: r.ScriptCostUsd, TTSClips: int(r.TtsClips),
		TTSAudioSec: float64(r.TtsAudioMs) / 1000, TTSCostUSD: r.TtsCostUsd, Images: int(r.Images), ImageCostUSD: r.ImageCostUsd,
		SimulationUSD: r.SimulationCostUsd}, nil
}

// ---- generated speech cache ----

type TTSAudio struct {
	ID          int64
	Model       string
	Voice       string
	Language    string
	TextHash    string
	Text        string
	StorageKey  string
	ContentType string
	Bytes       int
	DurationMs  int
	CostUSD     float64
}

func toTTS(r gen.TtsAudio) *TTSAudio {
	return &TTSAudio{ID: r.ID, Model: r.Model, Voice: r.Voice, Language: r.Language, TextHash: r.TextHash, Text: r.Text,
		StorageKey: r.StorageKey, ContentType: r.ContentType, Bytes: int(r.Bytes), DurationMs: int(r.DurationMs), CostUSD: r.CostUsd}
}

func (s *Store) GetTTSAudio(ctx context.Context, model, voice, textHash string) (*TTSAudio, error) {
	r, err := s.q.GetTTSAudio(ctx, gen.GetTTSAudioParams{Model: model, Voice: voice, TextHash: textHash})
	if err != nil {
		return nil, mapErr(err)
	}
	return toTTS(r), nil
}

// CachedTTS reports which (voice, text hash) pairs already have audio.
func (s *Store) CachedTTS(ctx context.Context, model string, hashes []string) (map[[2]string]bool, error) {
	rows, err := s.q.ListTTSHashes(ctx, gen.ListTTSHashesParams{Model: model, Hashes: hashes})
	if err != nil {
		return nil, err
	}
	out := make(map[[2]string]bool, len(rows))
	for _, r := range rows {
		out[[2]string{r.Voice, r.TextHash}] = true
	}
	return out, nil
}

// SaveTTSAudio stores the clip's metadata. If another request stored the same
// clip first, that row is returned and created is false.
func (s *Store) SaveTTSAudio(ctx context.Context, userID int64, a *TTSAudio) (out *TTSAudio, created bool, err error) {
	r, err := s.q.CreateTTSAudio(ctx, gen.CreateTTSAudioParams{Model: a.Model, Voice: a.Voice, Language: a.Language, TextHash: a.TextHash,
		Text: a.Text, StorageKey: a.StorageKey, ContentType: a.ContentType, Bytes: int32(a.Bytes), DurationMs: int32(a.DurationMs),
		CostUsd: a.CostUSD, CreatedBy: pgtype.Int8{Int64: userID, Valid: true}})
	if err == nil {
		return toTTS(r), true, nil
	}
	if mapErr(err) != ErrNotFound { // ON CONFLICT DO NOTHING returns no row
		return nil, false, err
	}
	existing, err := s.GetTTSAudio(ctx, a.Model, a.Voice, a.TextHash)
	return existing, false, err
}
