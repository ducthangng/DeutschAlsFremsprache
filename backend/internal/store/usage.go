package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
)

// Assessment is one pronunciation grading as logged for cost tracking.
type Assessment struct {
	UserID    int64
	ItemID    *int64
	Provider  string
	AudioMs   int
	LatencyMs int
	PronScore float64
	Passed    bool
	CostUSD   float64
	// SimulationID is set for gradings made during a simulation.
	SimulationID *int64
}

func (s *Store) LogAssessment(ctx context.Context, a Assessment) error {
	return s.q.CreateAssessment(ctx, gen.CreateAssessmentParams{UserID: a.UserID, ItemID: optInt8(a.ItemID), Provider: a.Provider,
		AudioMs: int32(a.AudioMs), LatencyMs: int32(a.LatencyMs), PronScore: a.PronScore, Passed: a.Passed, CostUsd: a.CostUSD,
		SimulationID: optInt8(a.SimulationID)})
}

type UsagePeriod struct {
	Since              time.Time `json:"since"`
	Gradings           int       `json:"gradings"`
	Passed             int       `json:"passed"`
	AudioSeconds       float64   `json:"audioSeconds"`
	GradingCostUSD     float64   `json:"gradingCostUsd"`
	TranslationCalls   int       `json:"translationCalls"`
	TranslationChars   int64     `json:"translationChars"`
	TranslationCostUSD float64   `json:"translationCostUsd"`
}

type RecentAssessment struct {
	ID         int64     `json:"id"`
	Provider   string    `json:"provider"`
	AudioMs    int       `json:"audioMs"`
	LatencyMs  int       `json:"latencyMs"`
	PronScore  float64   `json:"pronScore"`
	Passed     bool      `json:"passed"`
	CostUSD    float64   `json:"costUsd"`
	CreatedAt  time.Time `json:"createdAt"`
	ItemText   string    `json:"itemText"`
	TopicTitle string    `json:"topicTitle"`
}

// Usage sums Azure gradings and paid translations since the given time.
func (s *Store) Usage(ctx context.Context, userID int64, since time.Time) (*UsagePeriod, error) {
	a, err := s.q.AssessmentUsage(ctx, gen.AssessmentUsageParams{UserID: userID, Since: since})
	if err != nil {
		return nil, err
	}
	t, err := s.q.TranslationUsage(ctx, gen.TranslationUsageParams{UserID: pgtype.Int8{Int64: userID, Valid: true}, Since: since})
	if err != nil {
		return nil, err
	}
	return &UsagePeriod{Since: since, Gradings: int(a.Gradings), Passed: int(a.Passed), AudioSeconds: float64(a.AudioMs) / 1000,
		GradingCostUSD: a.CostUsd, TranslationCalls: int(t.Requests), TranslationChars: t.Chars, TranslationCostUSD: t.CostUsd}, nil
}

func (s *Store) RecentAssessments(ctx context.Context, userID int64, limit int) ([]*RecentAssessment, error) {
	rows, err := s.q.ListRecentAssessments(ctx, gen.ListRecentAssessmentsParams{UserID: userID, Limit: int32(limit)})
	if err != nil {
		return nil, err
	}
	out := make([]*RecentAssessment, len(rows))
	for i, r := range rows {
		out[i] = &RecentAssessment{ID: r.ID, Provider: r.Provider, AudioMs: int(r.AudioMs), LatencyMs: int(r.LatencyMs), PronScore: r.PronScore,
			Passed: r.Passed, CostUSD: r.CostUsd, CreatedAt: r.CreatedAt, ItemText: r.ItemText, TopicTitle: r.TopicTitle}
	}
	return out, nil
}

// ---- translation cache ----

type CachedTranslation struct {
	Text     string
	Provider string
}

func (s *Store) CachedTranslations(ctx context.Context, from, to string, texts []string) (map[string]CachedTranslation, error) {
	rows, err := s.q.GetTranslations(ctx, gen.GetTranslationsParams{SourceLang: from, TargetLang: to, Texts: texts})
	if err != nil {
		return nil, err
	}
	out := make(map[string]CachedTranslation, len(rows))
	for _, r := range rows {
		out[r.SourceText] = CachedTranslation{Text: r.TranslatedText, Provider: r.Provider}
	}
	return out, nil
}

func (s *Store) SaveTranslation(ctx context.Context, userID int64, from, to, source, translated, provider string, chars int, cost float64) error {
	return s.q.SaveTranslation(ctx, gen.SaveTranslationParams{SourceLang: from, TargetLang: to, SourceText: source, TranslatedText: translated,
		Provider: provider, Chars: int32(chars), CostUsd: cost, UserID: pgtype.Int8{Int64: userID, Valid: true}})
}
