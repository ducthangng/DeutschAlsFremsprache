// Package store is the persistence layer: it wraps the sqlc-generated
// queries (internal/db/gen) with transactions and API-facing types.
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"deutschfremsprache/internal/db"
	"deutschfremsprache/internal/db/gen"
	"deutschfremsprache/internal/topic"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Store struct {
	pool *pgxpool.Pool
	q    *gen.Queries
}

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Topic struct {
	ID          int64     `json:"id"`
	UserID      int64     `json:"-"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Language    string    `json:"language"`
	Kind        string    `json:"kind"`
	Visibility  string    `json:"visibility"` // private | public
	CoverKey    string    `json:"coverKey"`
	CoverURL    string    `json:"coverUrl"` // filled in by the API layer
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	ItemCount   int       `json:"itemCount"`
	PassedCount int       `json:"passedCount"` // lines the viewer has passed (shadowing)
	// DictationPassedCount is lines the viewer has passed in "Listen -> Write".
	DictationPassedCount int `json:"dictationPassedCount"`
	// LastPracticedAt is the viewer's latest grading in this topic, nil if never.
	LastPracticedAt *time.Time `json:"lastPracticedAt"`
	OwnerName       string     `json:"ownerName"`
	IsOwner         bool       `json:"isOwner"`
	Completions     int        `json:"completions"`  // times finished, by anyone
	TotalCost       float64    `json:"totalCostUsd"` // gradings + AI generation, by anyone
}

type Item struct {
	ID       int64  `json:"id"`
	TopicID  int64  `json:"topicId"`
	Position int    `json:"position"`
	Speaker  string `json:"speaker"`
	Text     string `json:"text"`
	Note     string `json:"note"`
	ImageKey string `json:"imageKey"`
	ImageURL string `json:"imageUrl"` // filled in by the API layer
}

type Recording struct {
	ID           int64     `json:"id"`
	ItemID       int64     `json:"itemId"`
	UserID       int64     `json:"-"`
	FileName     string    `json:"-"` // media storage key ("recordings/…"); bare names are legacy local files
	Score        float64   `json:"score"`
	Accuracy     float64   `json:"accuracy"`
	Fluency      float64   `json:"fluency"`
	Completeness float64   `json:"completeness"`
	CostUSD      float64   `json:"costUsd"` // grading cost of this take
	Result       []byte    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Open connects to Postgres and applies pending migrations.
func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{pool: pool, q: gen.New(pool)}, nil
}

func (s *Store) Close() { s.pool.Close() }

// mapErr translates driver errors into store errors.
func mapErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
		return ErrConflict
	}
	return err
}

// inTx runs fn in a transaction, committing only if it returns nil.
func (s *Store) inTx(ctx context.Context, fn func(q *gen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---- users ----

func toUser(u gen.User) *User {
	return &User{ID: u.ID, Email: u.Email, Name: u.Name, PasswordHash: u.PasswordHash, CreatedAt: u.CreatedAt}
}

func (s *Store) CreateUser(ctx context.Context, email, name, hash string) (*User, error) {
	u, err := s.q.CreateUser(ctx, gen.CreateUserParams{Email: email, Name: name, PasswordHash: hash})
	if err != nil {
		return nil, mapErr(err)
	}
	return toUser(u), nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (*User, error) {
	u, err := s.q.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, mapErr(err)
	}
	return toUser(u), nil
}

func (s *Store) UserByID(ctx context.Context, id int64) (*User, error) {
	u, err := s.q.GetUserByID(ctx, id)
	if err != nil {
		return nil, mapErr(err)
	}
	return toUser(u), nil
}

// ---- topics ----

// The three topic queries return identically shaped rows.
func toTopic(r gen.GetTopicForViewerRow, viewerID int64) *Topic {
	t := &Topic{ID: r.ID, UserID: r.UserID, Title: r.Title, Description: r.Description, Language: r.Language, Kind: r.Kind,
		Visibility: r.Visibility, CoverKey: r.CoverKey, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, ItemCount: int(r.ItemCount),
		PassedCount: int(r.PassedCount), DictationPassedCount: int(r.DictationPassedCount), OwnerName: r.OwnerName,
		IsOwner: r.UserID == viewerID, Completions: int(r.Completions), TotalCost: r.TotalCostUsd}
	if r.LastPracticedAt.Unix() > 0 {
		at := r.LastPracticedAt
		t.LastPracticedAt = &at
	}
	return t
}

func (s *Store) ListTopics(ctx context.Context, userID int64) ([]*Topic, error) {
	rows, err := s.q.ListTopicsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]*Topic, len(rows))
	for i, r := range rows {
		out[i] = toTopic(gen.GetTopicForViewerRow(r), userID)
	}
	return out, nil
}

func (s *Store) ListPublicTopics(ctx context.Context, viewerID int64) ([]*Topic, error) {
	rows, err := s.q.ListPublicTopics(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	out := make([]*Topic, len(rows))
	for i, r := range rows {
		out[i] = toTopic(gen.GetTopicForViewerRow(r), viewerID)
	}
	return out, nil
}

// GetTopic returns the topic if the viewer owns it or it is public.
// Check IsOwner before allowing changes.
func (s *Store) GetTopic(ctx context.Context, viewerID, id int64) (*Topic, error) {
	return getTopic(ctx, s.q, viewerID, id)
}

func getTopic(ctx context.Context, q *gen.Queries, viewerID, id int64) (*Topic, error) {
	r, err := q.GetTopicForViewer(ctx, gen.GetTopicForViewerParams{ID: id, ViewerID: viewerID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toTopic(r, viewerID), nil
}

func (s *Store) SetTopicVisibility(ctx context.Context, userID, id int64, visibility string) error {
	n, err := s.q.SetTopicVisibility(ctx, gen.SetTopicVisibilityParams{ID: id, UserID: userID, Visibility: visibility})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddTopicCompletion(ctx context.Context, userID, topicID int64) error {
	return s.q.AddTopicCompletion(ctx, gen.AddTopicCompletionParams{TopicID: topicID, UserID: userID})
}

// TopicCost is one person's spending on a topic.
type TopicCost struct {
	UserID     int64   `json:"userId"`
	Name       string  `json:"name"`
	Gradings   int     `json:"gradings"`
	GradingUSD float64 `json:"gradingCostUsd"`
	ScriptUSD  float64 `json:"scriptCostUsd"`
	TTSUSD     float64 `json:"ttsCostUsd"`
	TotalUSD   float64 `json:"totalCostUsd"`
}

func (s *Store) TopicCosts(ctx context.Context, topicID int64) ([]*TopicCost, error) {
	rows, err := s.q.TopicCostsByUser(ctx, topicID)
	if err != nil {
		return nil, err
	}
	out := make([]*TopicCost, len(rows))
	for i, r := range rows {
		out[i] = &TopicCost{UserID: r.UserID, Name: r.Name, Gradings: int(r.Gradings), GradingUSD: r.GradingCostUsd, ScriptUSD: r.ScriptCostUsd,
			TTSUSD: r.TtsCostUsd, TotalUSD: r.GradingCostUsd + r.ScriptCostUsd + r.TtsCostUsd}
	}
	return out, nil
}

// NewTopicExtras are optional side effects of creating a topic from an AI generation.
type NewTopicExtras struct {
	GenerationIDs []int64      // ai_usage rows of script generations, attributed to the new topic
	Vocabulary    []VocabEntry // terms to add to the owner's Vocabulary Pocket (existing ones are kept)
}

func (s *Store) CreateTopic(ctx context.Context, t *Topic, lines []topic.Line, extras NewTopicExtras) (*Topic, error) {
	var out *Topic
	err := s.inTx(ctx, func(q *gen.Queries) error {
		id, err := q.CreateTopic(ctx, gen.CreateTopicParams{UserID: t.UserID, Title: t.Title, Description: t.Description, Language: t.Language, Kind: t.Kind, Visibility: t.Visibility, CoverKey: t.CoverKey})
		if err != nil {
			return err
		}
		for i, l := range lines {
			if err := q.CreateItem(ctx, gen.CreateItemParams{TopicID: id, Position: int32(i), Speaker: l.Speaker, Text: l.Text, Note: l.Note, ImageKey: l.ImageKey}); err != nil {
				return err
			}
		}
		for _, gid := range extras.GenerationIDs {
			if err := q.LinkAIUsageToTopic(ctx, gen.LinkAIUsageToTopicParams{ID: gid, UserID: t.UserID, TopicID: pgtype.Int8{Int64: id, Valid: true}}); err != nil {
				return err
			}
		}
		for _, v := range extras.Vocabulary {
			if err := q.AddVocabIfMissing(ctx, gen.AddVocabIfMissingParams{UserID: t.UserID, Language: t.Language, Term: v.Term, Meaning: v.Meaning,
				TopicID: pgtype.Int8{Int64: id, Valid: true}}); err != nil {
				return err
			}
		}
		out, err = getTopic(ctx, q, t.UserID, id)
		return err
	})
	return out, err
}

// UpdateTopic rewrites a topic's metadata and lines. Lines whose speaker and
// text are unchanged keep their item ID (and therefore their recordings);
// removed lines are deleted. It returns the audio files of deleted recordings
// so the caller can remove them from disk.
func (s *Store) UpdateTopic(ctx context.Context, t *Topic, lines []topic.Line) (*Topic, []string, error) {
	var (
		out   *Topic
		files []string
	)
	err := s.inTx(ctx, func(q *gen.Queries) error {
		n, err := q.UpdateTopic(ctx, gen.UpdateTopicParams{ID: t.ID, UserID: t.UserID, Title: t.Title, Description: t.Description, Language: t.Language, Kind: t.Kind, Visibility: t.Visibility, CoverKey: t.CoverKey})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		existing, err := q.ListItemsByTopic(ctx, t.ID)
		if err != nil {
			return err
		}
		pool := map[string][]int64{}
		for _, it := range existing {
			k := it.Speaker + "\x00" + it.Text
			pool[k] = append(pool[k], it.ID)
		}
		for i, l := range lines {
			k := l.Speaker + "\x00" + l.Text
			if ids := pool[k]; len(ids) > 0 {
				pool[k] = ids[1:]
				if err := q.UpdateItemPosition(ctx, gen.UpdateItemPositionParams{ID: ids[0], Position: int32(i), Note: l.Note, ImageKey: l.ImageKey}); err != nil {
					return err
				}
				continue
			}
			if err := q.CreateItem(ctx, gen.CreateItemParams{TopicID: t.ID, Position: int32(i), Speaker: l.Speaker, Text: l.Text, Note: l.Note, ImageKey: l.ImageKey}); err != nil {
				return err
			}
		}
		for _, ids := range pool {
			for _, id := range ids {
				f, err := q.ListRecordingFilesByItem(ctx, id)
				if err != nil {
					return err
				}
				files = append(files, f...)
				if err := q.DeleteItem(ctx, id); err != nil {
					return err
				}
			}
		}
		out, err = getTopic(ctx, q, t.UserID, t.ID)
		return err
	})
	if err != nil {
		return nil, nil, mapErr(err)
	}
	return out, files, nil
}

// DeleteTopic removes the topic and returns audio files that should be deleted.
func (s *Store) DeleteTopic(ctx context.Context, userID, id int64) ([]string, error) {
	var files []string
	err := s.inTx(ctx, func(q *gen.Queries) error {
		var err error
		files, err = q.ListRecordingFilesByTopic(ctx, gen.ListRecordingFilesByTopicParams{TopicID: id, UserID: userID})
		if err != nil {
			return err
		}
		n, err := q.DeleteTopic(ctx, gen.DeleteTopicParams{ID: id, UserID: userID})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return nil
	})
	return files, mapErr(err)
}

// ---- items ----

func toItem(it gen.Item) *Item {
	return &Item{ID: it.ID, TopicID: it.TopicID, Position: int(it.Position), Speaker: it.Speaker, Text: it.Text, Note: it.Note, ImageKey: it.ImageKey}
}

func (s *Store) ListItems(ctx context.Context, topicID int64) ([]*Item, error) {
	rows, err := s.q.ListItemsByTopic(ctx, topicID)
	if err != nil {
		return nil, err
	}
	out := make([]*Item, len(rows))
	for i, r := range rows {
		out[i] = toItem(r)
	}
	return out, nil
}

// GetItem returns an item together with its topic, if the viewer may read it
// (own or public topic).
func (s *Store) GetItem(ctx context.Context, viewerID, id int64) (*Item, *Topic, error) {
	it, err := s.q.GetItemForViewer(ctx, gen.GetItemForViewerParams{ID: id, ViewerID: viewerID})
	if err != nil {
		return nil, nil, mapErr(err)
	}
	t, err := s.GetTopic(ctx, viewerID, it.TopicID)
	return toItem(it), t, err
}

// ---- recordings ----

func toRecording(r gen.Recording) *Recording {
	return &Recording{ID: r.ID, ItemID: r.ItemID, UserID: r.UserID, FileName: r.FileName, Score: r.Score, Accuracy: r.Accuracy,
		Fluency: r.Fluency, Completeness: r.Completeness, CostUSD: r.CostUsd, Result: r.Result, CreatedAt: r.CreatedAt}
}

// CreateRecording inserts r and fills in its ID and CreatedAt.
func (s *Store) CreateRecording(ctx context.Context, r *Recording) error {
	row, err := s.q.CreateRecording(ctx, gen.CreateRecordingParams{ItemID: r.ItemID, UserID: r.UserID, FileName: r.FileName,
		Score: r.Score, Accuracy: r.Accuracy, Fluency: r.Fluency, Completeness: r.Completeness, Result: r.Result, CostUsd: r.CostUSD})
	if err != nil {
		return mapErr(err)
	}
	*r = *toRecording(row)
	return nil
}

// ListRecordingsByTopic returns all recordings of a topic, newest first.
func (s *Store) ListRecordingsByTopic(ctx context.Context, userID, topicID int64) ([]*Recording, error) {
	rows, err := s.q.ListRecordingsByTopic(ctx, gen.ListRecordingsByTopicParams{TopicID: topicID, UserID: userID})
	if err != nil {
		return nil, err
	}
	out := make([]*Recording, len(rows))
	for i, r := range rows {
		out[i] = toRecording(r)
	}
	return out, nil
}

func (s *Store) GetRecording(ctx context.Context, userID, id int64) (*Recording, error) {
	r, err := s.q.GetRecordingForUser(ctx, gen.GetRecordingForUserParams{ID: id, UserID: userID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toRecording(r), nil
}

// DeleteRecording removes the row and returns its audio file name.
func (s *Store) DeleteRecording(ctx context.Context, userID, id int64) (string, error) {
	f, err := s.q.DeleteRecording(ctx, gen.DeleteRecordingParams{ID: id, UserID: userID})
	return f, mapErr(err)
}

// LegacyRecordings lists recordings whose audio still lives on local disk
// (file names without the "recordings/" storage prefix).
func (s *Store) LegacyRecordings(ctx context.Context) (map[int64]string, error) {
	rows, err := s.q.ListLegacyRecordings(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.FileName
	}
	return out, nil
}

func (s *Store) SetRecordingFileName(ctx context.Context, id int64, name string) error {
	return s.q.SetRecordingFileName(ctx, gen.SetRecordingFileNameParams{ID: id, FileName: name})
}
