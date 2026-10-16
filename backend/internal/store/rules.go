package store

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
)

// NeedsPublicError: private topics would end up in a public playlist.
// The caller should ask the user and retry with makePublic.
type NeedsPublicError struct{ Topics []string }

func (e *NeedsPublicError) Error() string {
	return "private topics in a public playlist: " + strings.Join(e.Topics, ", ")
}

// InPublicPlaylistError: a topic cannot become private while public playlists contain it.
type InPublicPlaylistError struct{ Playlists []string }

func (e *InPublicPlaylistError) Error() string {
	return "topic is in public playlists: " + strings.Join(e.Playlists, ", ")
}

// CheckCanMakePrivate returns *InPublicPlaylistError if public playlists contain the topic.
func (s *Store) CheckCanMakePrivate(ctx context.Context, topicID int64) error {
	rows, err := s.q.PublicPlaylistsWithTopic(ctx, topicID)
	if err != nil || len(rows) == 0 {
		return err
	}
	e := &InPublicPlaylistError{}
	for _, r := range rows {
		e.Playlists = append(e.Playlists, r.Name)
	}
	return e
}

// ---- avatars ----

func (s *Store) SetUserAvatar(ctx context.Context, userID int64, key string) (*User, error) {
	u, err := s.q.SetUserAvatar(ctx, gen.SetUserAvatarParams{ID: userID, AvatarKey: key})
	if err != nil {
		return nil, mapErr(err)
	}
	return toUser(u), nil
}

// ---- participants ----

type Participant struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	AvatarKey string    `json:"-"`
	AvatarURL string    `json:"avatarUrl"` // filled in by the API layer
	LastAt    time.Time `json:"lastAt"`
}

func (s *Store) TopicParticipants(ctx context.Context, topicID int64) ([]*Participant, error) {
	rows, err := s.q.TopicParticipants(ctx, topicID)
	if err != nil {
		return nil, err
	}
	out := make([]*Participant, len(rows))
	for i, r := range rows {
		out[i] = &Participant{ID: r.ID, Name: r.Name, AvatarKey: r.AvatarKey, LastAt: r.LastAt}
	}
	return out, nil
}

func (s *Store) PlaylistParticipants(ctx context.Context, playlistID int64) ([]*Participant, error) {
	rows, err := s.q.PlaylistParticipants(ctx, playlistID)
	if err != nil {
		return nil, err
	}
	out := make([]*Participant, len(rows))
	for i, r := range rows {
		out[i] = &Participant{ID: r.ID, Name: r.Name, AvatarKey: r.AvatarKey, LastAt: r.LastAt}
	}
	return out, nil
}

// ---- topic vocabulary ----

// TopicOwnerVocab is the topic owner's word list for the topic.
func (s *Store) TopicOwnerVocab(ctx context.Context, topicID int64) ([]VocabEntry, error) {
	rows, err := s.q.TopicOwnerVocab(ctx, pgtype.Int8{Int64: topicID, Valid: true})
	if err != nil {
		return nil, err
	}
	out := make([]VocabEntry, len(rows))
	for i, r := range rows {
		out[i] = VocabEntry{Term: r.Term, Meaning: r.Meaning, Example: r.Example, ImageKey: r.ImageKey}
	}
	return out, nil
}
