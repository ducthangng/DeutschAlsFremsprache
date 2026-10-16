package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
	"deutschfremsprache/internal/srs"
)

type VocabEntry struct {
	ID       int64     `json:"id"`
	Language string    `json:"language"`
	Term     string    `json:"term"`
	Meaning  string    `json:"meaning"`
	Example  string    `json:"example"`
	TopicID  *int64    `json:"topicId"`
	ImageKey string    `json:"imageKey"`
	ImageURL string    `json:"imageUrl"` // filled in by the API layer
	DueAt    time.Time `json:"dueAt"`
	Reviews  int       `json:"reviews"`
	Lapses   int       `json:"lapses"`
	Ease     float64   `json:"ease"`
	Interval float64   `json:"intervalDays"`
	Reps     int       `json:"reps"`
	State    string    `json:"state"` // new | learning | young | mature
	// NextIn previews, per answer (again/hard/good/easy), seconds until the card is due again.
	NextIn    map[string]int64 `json:"nextIn"`
	CreatedAt time.Time        `json:"createdAt"`
}

var gradeNames = map[srs.Grade]string{srs.Again: "again", srs.Hard: "hard", srs.Good: "good", srs.Easy: "easy"}

func toVocab(v gen.VocabEntry) *VocabEntry {
	card := srs.Card{Ease: v.Ease, Interval: v.IntervalDays, Reps: int(v.Reps)}
	out := &VocabEntry{ID: v.ID, Language: v.Language, Term: v.Term, Meaning: v.Meaning, Example: v.Example, ImageKey: v.ImageKey,
		DueAt: v.DueAt, Reviews: int(v.Reviews), Lapses: int(v.Lapses), Ease: v.Ease, Interval: v.IntervalDays, Reps: int(v.Reps),
		State: srs.State(card, int(v.Reviews)), NextIn: map[string]int64{}, CreatedAt: v.CreatedAt}
	for g, d := range srs.Preview(card) {
		out.NextIn[gradeNames[g]] = int64(d.Seconds())
	}
	if v.TopicID.Valid {
		id := v.TopicID.Int64
		out.TopicID = &id
	}
	return out
}

func optInt8(p *int64) pgtype.Int8 {
	if p == nil {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: *p, Valid: true}
}

func (s *Store) ListVocab(ctx context.Context, userID int64) ([]*VocabEntry, error) {
	rows, err := s.q.ListVocab(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]*VocabEntry, len(rows))
	for i, r := range rows {
		out[i] = toVocab(r)
	}
	return out, nil
}

func (s *Store) GetVocab(ctx context.Context, userID, id int64) (*VocabEntry, error) {
	v, err := s.q.GetVocab(ctx, gen.GetVocabParams{ID: id, UserID: userID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toVocab(v), nil
}

// CreateVocab returns ErrConflict if the user already has this term.
func (s *Store) CreateVocab(ctx context.Context, userID int64, v *VocabEntry) (*VocabEntry, error) {
	row, err := s.q.CreateVocab(ctx, gen.CreateVocabParams{UserID: userID, Language: v.Language, Term: v.Term,
		Meaning: v.Meaning, Example: v.Example, TopicID: optInt8(v.TopicID), ImageKey: v.ImageKey})
	if err != nil {
		return nil, mapErr(err)
	}
	return toVocab(row), nil
}

func (s *Store) UpdateVocab(ctx context.Context, userID int64, v *VocabEntry) (*VocabEntry, error) {
	row, err := s.q.UpdateVocab(ctx, gen.UpdateVocabParams{ID: v.ID, UserID: userID, Term: v.Term, Meaning: v.Meaning, Example: v.Example, ImageKey: v.ImageKey})
	if err != nil {
		return nil, mapErr(err)
	}
	return toVocab(row), nil
}

func (s *Store) SetVocabImage(ctx context.Context, userID, id int64, key string) (*VocabEntry, error) {
	row, err := s.q.SetVocabImage(ctx, gen.SetVocabImageParams{ID: id, UserID: userID, ImageKey: key})
	if err != nil {
		return nil, mapErr(err)
	}
	return toVocab(row), nil
}

func (s *Store) DeleteVocab(ctx context.Context, userID, id int64) error {
	n, err := s.q.DeleteVocab(ctx, gen.DeleteVocabParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReviewVocab schedules the card's next review and logs the answer.
func (s *Store) ReviewVocab(ctx context.Context, userID, id int64, grade srs.Grade, durationMs int) (*VocabEntry, error) {
	var out *VocabEntry
	err := s.inTx(ctx, func(q *gen.Queries) error {
		cur, err := q.GetVocab(ctx, gen.GetVocabParams{ID: id, UserID: userID})
		if err != nil {
			return err
		}
		card, due := srs.Next(srs.Card{Ease: cur.Ease, Interval: cur.IntervalDays, Reps: int(cur.Reps)}, grade, time.Now())
		lapse := int32(0)
		if grade == srs.Again && cur.Reps > 0 {
			lapse = 1
		}
		row, err := q.ReviewVocab(ctx, gen.ReviewVocabParams{ID: id, UserID: userID, Ease: card.Ease, IntervalDays: card.Interval,
			Reps: int32(card.Reps), DueAt: due, Lapse: lapse})
		if err != nil {
			return err
		}
		if err := q.LogVocabReview(ctx, gen.LogVocabReviewParams{UserID: userID, VocabID: pgtype.Int8{Int64: id, Valid: true},
			Grade: int16(grade), IntervalDays: card.Interval, DurationMs: int32(durationMs)}); err != nil {
			return err
		}
		out = toVocab(row)
		return nil
	})
	return out, mapErr(err)
}

// ReviewDay is one local calendar day of review activity.
type ReviewDay struct {
	Day        time.Time
	Reviews    int
	Remembered int
	DurationMs int64
}

// ReviewDays returns every day with reviews, in the user's time zone
// (offset in minutes east of UTC), oldest first.
func (s *Store) ReviewDays(ctx context.Context, userID int64, offsetMinutes int) ([]ReviewDay, error) {
	rows, err := s.q.VocabReviewDays(ctx, gen.VocabReviewDaysParams{UserID: userID, OffsetMinutes: int32(offsetMinutes)})
	if err != nil {
		return nil, err
	}
	out := make([]ReviewDay, len(rows))
	for i, r := range rows {
		out[i] = ReviewDay{Day: r.Day.Time, Reviews: int(r.Reviews), Remembered: int(r.Remembered), DurationMs: r.DurationMs}
	}
	return out, nil
}
