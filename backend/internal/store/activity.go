package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
)

// ---- admin activity feed ----

// Activity is one learner session: practicing ("shadow") or dictating
// ("write") a topic on one day, a simulation, or creating a topic ("create").
type Activity struct {
	Kind             string    `json:"kind"`
	UserID           int64     `json:"userId"`
	UserName         string    `json:"userName"`
	UserAvatarKey    string    `json:"-"`
	UserAvatarURL    string    `json:"userAvatarUrl"`
	TopicID          int64     `json:"topicId"`
	TopicTitle       string    `json:"topicTitle"`
	Language         string    `json:"language"`
	TopicLines       int       `json:"topicLines"`
	SimulationID     int64     `json:"simulationId"`
	SimulationTitle  string    `json:"simulationTitle"`
	SimulationStatus string    `json:"simulationStatus"`
	Day              string    `json:"day"` // YYYY-MM-DD, Vietnam time
	Attempts         int       `json:"attempts"`
	Passed           int       `json:"passed"`
	Lines            int       `json:"lines"` // distinct lines tried (simulation: user turns)
	AvgScore         float64   `json:"avgScore"`
	StartedAt        time.Time `json:"startedAt"`
	LastAt           time.Time `json:"lastAt"`
	Completed        bool      `json:"completed"`
}

type ActivityFilter struct {
	UserID int64
	Kind   string
	Offset int
	Limit  int
}

func (s *Store) ListActivity(ctx context.Context, f ActivityFilter) ([]*Activity, error) {
	rows, err := s.q.ListActivity(ctx, gen.ListActivityParams{UserID: f.UserID, Kind: f.Kind, Off: int32(f.Offset), Lim: int32(f.Limit)})
	if err != nil {
		return nil, err
	}
	out := make([]*Activity, len(rows))
	for i, r := range rows {
		out[i] = &Activity{Kind: r.Kind, UserID: r.UserID, UserName: r.UserName, UserAvatarKey: r.UserAvatarKey, TopicID: r.TopicID,
			TopicTitle: r.TopicTitle, Language: r.Language, TopicLines: int(r.TopicLines), SimulationID: r.SimulationID,
			SimulationTitle: r.SimulationTitle, SimulationStatus: r.SimulationStatus, Day: r.Day, Attempts: int(r.Attempts),
			Passed: int(r.Passed), Lines: int(r.Lines), AvgScore: r.AvgScore, StartedAt: r.StartedAt, LastAt: r.LastAt, Completed: r.Completed}
	}
	return out, nil
}

// ReviewLine is one line of a topic with what a learner did on it during a day.
type ReviewLine struct {
	ID         int64            `json:"id"`
	Position   int              `json:"position"`
	Speaker    string           `json:"speaker"`
	Text       string           `json:"text"`
	Note       string           `json:"note"`
	Attempts   []ReviewAttempt  `json:"attempts"`   // every grading, passed or not
	Recordings []ReviewTake     `json:"recordings"` // passed takes with audio
	Dictation  []ReviewDictated `json:"dictation"`
}

type ReviewAttempt struct {
	Score     float64   `json:"score"`
	Passed    bool      `json:"passed"`
	AudioMs   int       `json:"audioMs"`
	CreatedAt time.Time `json:"createdAt"`
}

type ReviewTake struct {
	ID           int64           `json:"id"`
	Score        float64         `json:"score"`
	Accuracy     float64         `json:"accuracy"`
	Fluency      float64         `json:"fluency"`
	Completeness float64         `json:"completeness"`
	Result       json.RawMessage `json:"result"` // {tokens, recognized}
	CreatedAt    time.Time       `json:"createdAt"`
}

type ReviewDictated struct {
	ID        int64     `json:"id"`
	Answer    string    `json:"answer"`
	Score     float64   `json:"score"`
	Passed    bool      `json:"passed"`
	CreatedAt time.Time `json:"createdAt"`
	Tokens    any       `json:"tokens"` // filled by the API (re-graded)
}

// ReviewDay collects a learner's work on a topic during one day (Vietnam time).
func (s *Store) ReviewDay(ctx context.Context, userID, topicID int64, day time.Time) ([]*ReviewLine, error) {
	items, err := s.q.ListTopicItems(ctx, topicID)
	if err != nil {
		return nil, err
	}
	lines := make([]*ReviewLine, len(items))
	byID := map[int64]*ReviewLine{}
	for i, it := range items {
		lines[i] = &ReviewLine{ID: it.ID, Position: int(it.Position), Speaker: it.Speaker, Text: it.Text, Note: it.Note,
			Attempts: []ReviewAttempt{}, Recordings: []ReviewTake{}, Dictation: []ReviewDictated{}}
		byID[it.ID] = lines[i]
	}
	d := pgtype.Date{Time: day, Valid: true}
	as, err := s.q.AdminDayAssessments(ctx, gen.AdminDayAssessmentsParams{UserID: userID, TopicID: topicID, Day: d})
	if err != nil {
		return nil, err
	}
	for _, a := range as {
		if l := byID[a.ItemID]; l != nil {
			l.Attempts = append(l.Attempts, ReviewAttempt{Score: a.PronScore, Passed: a.Passed, AudioMs: int(a.AudioMs), CreatedAt: a.CreatedAt})
		}
	}
	recs, err := s.q.AdminDayRecordings(ctx, gen.AdminDayRecordingsParams{UserID: userID, TopicID: topicID, Day: d})
	if err != nil {
		return nil, err
	}
	for _, r := range recs {
		if l := byID[r.ItemID]; l != nil {
			res := json.RawMessage(r.Result)
			if len(res) == 0 {
				res = json.RawMessage("{}")
			}
			l.Recordings = append(l.Recordings, ReviewTake{ID: r.ID, Score: r.Score, Accuracy: r.Accuracy, Fluency: r.Fluency,
				Completeness: r.Completeness, Result: res, CreatedAt: r.CreatedAt})
		}
	}
	dict, err := s.q.AdminDayDictation(ctx, gen.AdminDayDictationParams{UserID: userID, TopicID: topicID, Day: d})
	if err != nil {
		return nil, err
	}
	for _, a := range dict {
		if l := byID[a.ItemID]; l != nil {
			l.Dictation = append(l.Dictation, ReviewDictated{ID: a.ID, Answer: a.Answer, Score: a.Score, Passed: a.Passed, CreatedAt: a.CreatedAt})
		}
	}
	return lines, nil
}

// AdminRecording returns any learner's recording.
func (s *Store) AdminRecording(ctx context.Context, id int64) (*Recording, error) {
	r, err := s.q.AdminGetRecording(ctx, id)
	if err != nil {
		return nil, mapErr(err)
	}
	return toRecording(r), nil
}

// AdminSimulation returns any learner's simulation.
func (s *Store) AdminSimulation(ctx context.Context, id int64) (*Simulation, error) {
	r, err := s.q.AdminGetSimulation(ctx, id)
	if err != nil {
		return nil, mapErr(err)
	}
	return toSimulation(r), nil
}
