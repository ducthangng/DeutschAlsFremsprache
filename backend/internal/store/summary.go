package store

import (
	"context"
	"time"

	"deutschfremsprache/internal/db/gen"
)

type SessionStats struct {
	SpeakingMs        int64
	AvgScore          float64 // pronunciation, this session
	Gradings          int
	DictationAvg      float64
	DictationAttempts int
}

// SessionStats sums a user's practice of a topic since the session started.
func (s *Store) SessionStats(ctx context.Context, userID, topicID int64, since time.Time) (*SessionStats, error) {
	sp, err := s.q.SessionSpeaking(ctx, gen.SessionSpeakingParams{TopicID: topicID, UserID: userID, Since: since})
	if err != nil {
		return nil, err
	}
	d, err := s.q.SessionDictation(ctx, gen.SessionDictationParams{TopicID: topicID, UserID: userID, Since: since})
	if err != nil {
		return nil, err
	}
	return &SessionStats{SpeakingMs: sp.AudioMs, AvgScore: sp.AvgScore, Gradings: int(sp.Gradings),
		DictationAvg: d.AvgScore, DictationAttempts: int(d.Attempts)}, nil
}

func (s *Store) TotalSpeakingMs(ctx context.Context, userID int64) (int64, error) {
	return s.q.TotalSpeakingMs(ctx, userID)
}

// UserAverageScores maps every graded user to their average pronunciation score.
func (s *Store) UserAverageScores(ctx context.Context) (map[int64]float64, error) {
	rows, err := s.q.UserAverageScores(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]float64, len(rows))
	for _, r := range rows {
		out[r.UserID] = r.AvgScore
	}
	return out, nil
}

func (s *Store) VocabAddedSince(ctx context.Context, userID int64, since time.Time) ([]*VocabEntry, error) {
	rows, err := s.q.VocabAddedSince(ctx, gen.VocabAddedSinceParams{UserID: userID, CreatedAt: since})
	if err != nil {
		return nil, err
	}
	out := make([]*VocabEntry, len(rows))
	for i, r := range rows {
		out[i] = toVocab(r)
	}
	return out, nil
}
