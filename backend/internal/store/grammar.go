package store

import (
	"context"
	"encoding/json"
	"time"

	"deutschfremsprache/internal/db/gen"
)

type GrammarSet struct {
	ID       int64           `json:"id"`
	Grammar  string          `json:"grammar"`
	Level    string          `json:"level"`
	Model    string          `json:"model"`
	Sections json.RawMessage `json:"sections"`
	Status   string          `json:"status"` // generating | ready | failed
	Error    string          `json:"error"`
	Title    string          `json:"title"`
	CostUSD  float64         `json:"costUsd"`
	// Detail only.
	Content         json.RawMessage `json:"content,omitempty"`
	AudioKey        string          `json:"-"`
	AudioURL        string          `json:"audioUrl,omitempty"` // filled in by the API layer
	Answers         json.RawMessage `json:"answers,omitempty"`
	WritingFeedback json.RawMessage `json:"writingFeedback,omitempty"`
	// List only: the learner has answered something.
	Started   bool      `json:"started"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func toGrammarSet(r gen.GrammarSet) *GrammarSet {
	g := &GrammarSet{ID: r.ID, Grammar: r.Grammar, Level: r.Level, Model: r.Model, Sections: r.Sections, Status: r.Status, Error: r.Error,
		CostUSD: r.CostUsd, Content: r.Content, AudioKey: r.AudioKey, Answers: r.Answers, WritingFeedback: r.WritingFeedback,
		Started: r.Answers != nil, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	var c struct{ Title string }
	if json.Unmarshal(r.Content, &c) == nil {
		g.Title = c.Title
	}
	return g
}

func (s *Store) CreateGrammarSet(ctx context.Context, userID int64, grammar, level, model string, sections json.RawMessage) (*GrammarSet, error) {
	r, err := s.q.CreateGrammarSet(ctx, gen.CreateGrammarSetParams{UserID: userID, Grammar: grammar, Level: level, Model: model, Sections: sections})
	if err != nil {
		return nil, err
	}
	return toGrammarSet(r), nil
}

func (s *Store) GetGrammarSet(ctx context.Context, userID, id int64) (*GrammarSet, error) {
	r, err := s.q.GetGrammarSet(ctx, gen.GetGrammarSetParams{ID: id, UserID: userID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toGrammarSet(r), nil
}

func (s *Store) ListGrammarSets(ctx context.Context, userID int64) ([]*GrammarSet, error) {
	rows, err := s.q.ListGrammarSets(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]*GrammarSet, len(rows))
	for i, r := range rows {
		out[i] = &GrammarSet{ID: r.ID, Grammar: r.Grammar, Level: r.Level, Model: r.Model, Sections: r.Sections, Status: r.Status,
			Error: r.Error, Title: r.Title, CostUSD: r.CostUsd, Started: r.Started, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	}
	return out, nil
}

// FinishGrammarSet stores the generated content (status ready) or the reason
// it failed, and adds what the generation cost.
func (s *Store) FinishGrammarSet(ctx context.Context, id int64, status, errMsg string, content json.RawMessage, audioKey string, costUSD float64) error {
	return s.q.FinishGrammarSet(ctx, gen.FinishGrammarSetParams{ID: id, Status: status, Error: errMsg, Content: content, AudioKey: audioKey, CostUsd: costUSD})
}

func (s *Store) SaveGrammarAnswers(ctx context.Context, userID, id int64, answers json.RawMessage) error {
	n, err := s.q.SaveGrammarAnswers(ctx, gen.SaveGrammarAnswersParams{ID: id, UserID: userID, Answers: answers})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SaveGrammarWritingFeedback(ctx context.Context, userID, id int64, feedback json.RawMessage, costUSD float64) error {
	return s.q.SaveGrammarWritingFeedback(ctx, gen.SaveGrammarWritingFeedbackParams{ID: id, UserID: userID, Feedback: feedback, CostUsd: costUSD})
}

func (s *Store) DeleteGrammarSet(ctx context.Context, userID, id int64) error {
	n, err := s.q.DeleteGrammarSet(ctx, gen.DeleteGrammarSetParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) FailStaleGrammarSets(ctx context.Context) error { return s.q.FailStaleGrammarSets(ctx) }
