package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"deutschfremsprache/internal/db/gen"
)

type GrammarSet struct {
	ID       int64           `json:"id"`
	Grammar  string          `json:"grammar"`
	Level    string          `json:"level"`
	Model    string          `json:"model"`
	Sections json.RawMessage `json:"sections"`
	Status   string          `json:"status"` // generating | ready | failed
	// Pending is the part being added or written again ("" = none).
	Pending string  `json:"pending"`
	Error   string  `json:"error"`
	Title   string  `json:"title"`
	CostUSD float64 `json:"costUsd"`
	// Detail only.
	Content         json.RawMessage `json:"content,omitempty"`
	AudioKey        string          `json:"-"`
	VocabLevel      string          `json:"-"` // the words the set was built from
	Vocabulary      []string        `json:"-"`
	AudioURL        string          `json:"audioUrl,omitempty"` // filled in by the API layer
	Answers         json.RawMessage `json:"answers,omitempty"`
	WritingFeedback json.RawMessage `json:"writingFeedback,omitempty"`
	// List only: the learner has answered something, and how far they got per
	// section (written by the frontend with the answers).
	Started   bool            `json:"started"`
	Progress  json.RawMessage `json:"progress,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func toGrammarSet(r gen.GrammarSet) *GrammarSet {
	g := &GrammarSet{ID: r.ID, Grammar: r.Grammar, Level: r.Level, Model: r.Model, Sections: r.Sections, Status: r.Status, Error: r.Error,
		CostUSD: r.CostUsd, Content: r.Content, AudioKey: r.AudioKey, Answers: r.Answers, WritingFeedback: r.WritingFeedback,
		Started: r.Answers != nil, Pending: r.Pending, VocabLevel: r.VocabLevel, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
	json.Unmarshal(r.Vocabulary, &g.Vocabulary)
	var c struct{ Title string }
	if json.Unmarshal(r.Content, &c) == nil {
		g.Title = c.Title
	}
	return g
}

func (s *Store) CreateGrammarSet(ctx context.Context, userID int64, grammar, level, model string, sections json.RawMessage, vocabLevel string, vocabulary []string) (*GrammarSet, error) {
	if vocabulary == nil {
		vocabulary = []string{}
	}
	words, _ := json.Marshal(vocabulary)
	r, err := s.q.CreateGrammarSet(ctx, gen.CreateGrammarSetParams{UserID: userID, Grammar: grammar, Level: level, Model: model, Sections: sections,
		VocabLevel: vocabLevel, Vocabulary: words})
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
			Error: r.Error, Pending: r.Pending, Title: r.Title, CostUSD: r.CostUsd, Started: r.Started, Progress: r.Progress, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
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

func (s *Store) FailStaleGrammarSets(ctx context.Context) error {
	if err := s.q.FailStaleGrammarSets(ctx); err != nil {
		return err
	}
	return s.q.ClearStaleGrammarPending(ctx)
}

// StartGrammarSection marks one part of a ready set as being generated.
// ErrConflict when the set is not ready or another part is under way.
func (s *Store) StartGrammarSection(ctx context.Context, userID, id int64, section string) error {
	_, err := s.q.StartGrammarSection(ctx, gen.StartGrammarSectionParams{ID: id, UserID: userID, Section: section})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConflict
	}
	return err
}

// FinishGrammarSection stores the new part and clears the learner's work on it.
func (s *Store) FinishGrammarSection(ctx context.Context, id int64, section string, content, sections json.RawMessage, audioKey string, costUSD float64) error {
	return s.q.FinishGrammarSection(ctx, gen.FinishGrammarSectionParams{ID: id, Section: section, Content: content, Sections: sections, AudioKey: audioKey, CostUsd: costUSD})
}

// FailGrammarSection ends a part that could not be generated (content carries the reason).
func (s *Store) FailGrammarSection(ctx context.Context, id int64, content json.RawMessage, costUSD float64) error {
	return s.q.FailGrammarSection(ctx, gen.FailGrammarSectionParams{ID: id, Content: content, CostUsd: costUSD})
}
