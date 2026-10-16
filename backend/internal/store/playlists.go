package store

import (
	"context"
	"errors"
	"time"

	"deutschfremsprache/internal/db/gen"
)

type Playlist struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"-"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Level         string    `json:"level"`
	Visibility    string    `json:"visibility"`
	OwnerName     string    `json:"ownerName"`
	IsOwner       bool      `json:"isOwner"`
	Following     bool      `json:"following"`
	TopicCount    int       `json:"topicCount"`
	FollowerCount int       `json:"followerCount"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// The playlist queries return identically shaped rows.
func toPlaylist(r gen.GetPlaylistForViewerRow, viewerID int64) *Playlist {
	return &Playlist{ID: r.ID, UserID: r.UserID, Name: r.Name, Description: r.Description, Level: r.Level, Visibility: r.Visibility,
		OwnerName: r.OwnerName, IsOwner: r.UserID == viewerID, Following: r.Following, TopicCount: int(r.TopicCount),
		FollowerCount: int(r.FollowerCount), UpdatedAt: r.UpdatedAt}
}

func (s *Store) CreatePlaylist(ctx context.Context, p *Playlist) (*Playlist, error) {
	id, err := s.q.CreatePlaylist(ctx, gen.CreatePlaylistParams{UserID: p.UserID, Name: p.Name, Description: p.Description, Level: p.Level, Visibility: p.Visibility})
	if err != nil {
		return nil, err
	}
	return s.GetPlaylist(ctx, p.UserID, id)
}

func (s *Store) UpdatePlaylist(ctx context.Context, p *Playlist) (*Playlist, error) {
	n, err := s.q.UpdatePlaylist(ctx, gen.UpdatePlaylistParams{ID: p.ID, UserID: p.UserID, Name: p.Name, Description: p.Description, Level: p.Level, Visibility: p.Visibility})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}
	return s.GetPlaylist(ctx, p.UserID, p.ID)
}

func (s *Store) DeletePlaylist(ctx context.Context, userID, id int64) error {
	n, err := s.q.DeletePlaylist(ctx, gen.DeletePlaylistParams{ID: id, UserID: userID})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// GetPlaylist returns the playlist if the viewer owns it or it is public.
func (s *Store) GetPlaylist(ctx context.Context, viewerID, id int64) (*Playlist, error) {
	r, err := s.q.GetPlaylistForViewer(ctx, gen.GetPlaylistForViewerParams{ID: id, ViewerID: viewerID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toPlaylist(r, viewerID), nil
}

func (s *Store) ListMyPlaylists(ctx context.Context, viewerID int64) ([]*Playlist, error) {
	rows, err := s.q.ListMyPlaylists(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	out := make([]*Playlist, len(rows))
	for i, r := range rows {
		out[i] = toPlaylist(gen.GetPlaylistForViewerRow(r), viewerID)
	}
	return out, nil
}

func (s *Store) ListPublicPlaylists(ctx context.Context, viewerID int64) ([]*Playlist, error) {
	rows, err := s.q.ListPublicPlaylists(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	out := make([]*Playlist, len(rows))
	for i, r := range rows {
		out[i] = toPlaylist(gen.GetPlaylistForViewerRow(r), viewerID)
	}
	return out, nil
}

// PlaylistTopics returns the topics the viewer can open, in playlist order,
// and how many are hidden from them (the owner's private topics).
func (s *Store) PlaylistTopics(ctx context.Context, viewerID, playlistID int64) ([]*Topic, int, error) {
	ids, err := s.q.ListPlaylistTopicIDs(ctx, playlistID)
	if err != nil {
		return nil, 0, err
	}
	out := []*Topic{}
	hidden := 0
	for _, id := range ids {
		t, err := s.GetTopic(ctx, viewerID, id)
		if errors.Is(err, ErrNotFound) {
			hidden++
			continue
		}
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, hidden, nil
}

// ownPlaylist checks that the user owns the playlist.
func (s *Store) ownPlaylist(ctx context.Context, userID, playlistID int64) error {
	p, err := s.GetPlaylist(ctx, userID, playlistID)
	if err != nil {
		return err
	}
	if !p.IsOwner {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddPlaylistTopic(ctx context.Context, userID, playlistID, topicID int64) error {
	if err := s.ownPlaylist(ctx, userID, playlistID); err != nil {
		return err
	}
	if _, err := s.GetTopic(ctx, userID, topicID); err != nil { // own or public topics only
		return err
	}
	if err := s.q.AddPlaylistTopic(ctx, gen.AddPlaylistTopicParams{PlaylistID: playlistID, TopicID: topicID}); err != nil {
		return err
	}
	return s.q.TouchPlaylist(ctx, playlistID)
}

func (s *Store) RemovePlaylistTopic(ctx context.Context, userID, playlistID, topicID int64) error {
	if err := s.ownPlaylist(ctx, userID, playlistID); err != nil {
		return err
	}
	return s.q.RemovePlaylistTopic(ctx, gen.RemovePlaylistTopicParams{PlaylistID: playlistID, TopicID: topicID})
}

// ReorderPlaylist sets the order of the given topics (others keep their place after them).
func (s *Store) ReorderPlaylist(ctx context.Context, userID, playlistID int64, topicIDs []int64) error {
	if err := s.ownPlaylist(ctx, userID, playlistID); err != nil {
		return err
	}
	return s.inTx(ctx, func(q *gen.Queries) error {
		for i, id := range topicIDs {
			if err := q.SetPlaylistTopicPosition(ctx, gen.SetPlaylistTopicPositionParams{PlaylistID: playlistID, TopicID: id, Position: int32(i)}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) OwnPlaylistsWithTopic(ctx context.Context, userID, topicID int64) ([]int64, error) {
	ids, err := s.q.OwnPlaylistIDsWithTopic(ctx, gen.OwnPlaylistIDsWithTopicParams{UserID: userID, TopicID: topicID})
	if ids == nil {
		ids = []int64{}
	}
	return ids, err
}

// SetFollow follows or unfollows a public playlist.
func (s *Store) SetFollow(ctx context.Context, userID, playlistID int64, follow bool) error {
	p, err := s.GetPlaylist(ctx, userID, playlistID)
	if err != nil {
		return err
	}
	if !follow {
		return s.q.UnfollowPlaylist(ctx, gen.UnfollowPlaylistParams{PlaylistID: playlistID, UserID: userID})
	}
	if p.IsOwner {
		return ErrConflict // your own playlists are always in your list
	}
	return s.q.FollowPlaylist(ctx, gen.FollowPlaylistParams{PlaylistID: playlistID, UserID: userID})
}

// ---- dictation ----

func (s *Store) LogDictation(ctx context.Context, userID, itemID int64, answer string, score float64, passed bool) error {
	return s.q.CreateDictationAttempt(ctx, gen.CreateDictationAttemptParams{UserID: userID, ItemID: itemID, Answer: answer, Score: score, Passed: passed})
}

type DictationBest struct {
	Score  float64 `json:"score"`
	Passed bool    `json:"passed"`
}

func (s *Store) DictationBest(ctx context.Context, userID, topicID int64) (map[int64]DictationBest, error) {
	rows, err := s.q.DictationBestScores(ctx, gen.DictationBestScoresParams{TopicID: topicID, UserID: userID})
	if err != nil {
		return nil, err
	}
	out := make(map[int64]DictationBest, len(rows))
	for _, r := range rows {
		out[r.ItemID] = DictationBest{Score: r.BestScore, Passed: r.Passed}
	}
	return out, nil
}
