package api

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/dictation"
	"deutschfremsprache/internal/store"
)

type playlistInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Level       string `json:"level"`
	Visibility  string `json:"visibility"`
	// MakePublic confirms publishing the playlist's private topics (see NeedsPublicError).
	MakePublic bool `json:"makePublic"`
}

func (in *playlistInput) validate() string {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	if in.Visibility == "" {
		in.Visibility = "private"
	}
	switch {
	case in.Name == "" || utf8.RuneCountInString(in.Name) > 100:
		return "tên playlist cần từ 1 đến 100 ký tự"
	case utf8.RuneCountInString(in.Description) > 500:
		return "mô tả tối đa 500 ký tự"
	case in.Level != "" && !slices.Contains(levels, in.Level):
		return "trình độ không hợp lệ"
	case in.Visibility != "private" && in.Visibility != "public":
		return "trạng thái không hợp lệ"
	}
	return ""
}

// playlistProgress is the viewer's progress through a playlist.
type playlistProgress struct {
	TopicsDone  int     `json:"topicsDone"`  // topics fully passed (shadowing or listen-write)
	TopicsTotal int     `json:"topicsTotal"` // topics the viewer can open
	Percent     float64 `json:"percent"`     // average per-topic progress, 0..100
}

func progressOf(ts []*store.Topic) playlistProgress {
	p := playlistProgress{TopicsTotal: len(ts)}
	var sum float64
	for _, t := range ts {
		if t.ItemCount == 0 {
			continue
		}
		best := max(t.PassedCount, t.DictationPassedCount)
		if best >= t.ItemCount {
			p.TopicsDone++
		}
		sum += float64(best) / float64(t.ItemCount)
	}
	if len(ts) > 0 {
		p.Percent = float64(int(sum/float64(len(ts))*1000)) / 10
	}
	return p
}

type playlistView struct {
	*store.Playlist
	Progress playlistProgress `json:"progress"`
	CoverURL string           `json:"coverUrl"` // first topic with a cover
}

type playlistDetail struct {
	playlistView
	Topics       []*store.Topic `json:"topics"`
	HiddenTopics int            `json:"hiddenTopics"` // owner's private topics the viewer cannot open
}

func (s *Server) viewPlaylist(r *http.Request, p *store.Playlist) (*playlistDetail, error) {
	ts, hidden, err := s.store.PlaylistTopics(r.Context(), auth.UserID(r.Context()), p.ID)
	if err != nil {
		return nil, err
	}
	s.decorate(ts...)
	d := &playlistDetail{playlistView: playlistView{Playlist: p, Progress: progressOf(ts)}, Topics: ts, HiddenTopics: hidden}
	for _, t := range ts {
		if t.CoverURL != "" {
			d.CoverURL = t.CoverURL
			break
		}
	}
	return d, nil
}

func (s *Server) writePlaylistList(w http.ResponseWriter, r *http.Request, ps []*store.Playlist, err error) {
	if err != nil {
		writeStoreError(w, err)
		return
	}
	out := make([]playlistView, 0, len(ps))
	for _, p := range ps {
		d, err := s.viewPlaylist(r, p)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out = append(out, d.playlistView)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) listMyPlaylists(w http.ResponseWriter, r *http.Request) {
	ps, err := s.store.ListMyPlaylists(r.Context(), auth.UserID(r.Context()))
	s.writePlaylistList(w, r, ps, err)
}

func (s *Server) listPublicPlaylists(w http.ResponseWriter, r *http.Request) {
	ps, err := s.store.ListPublicPlaylists(r.Context(), auth.UserID(r.Context()))
	s.writePlaylistList(w, r, ps, err)
}

func (s *Server) getPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	p, err := s.store.GetPlaylist(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	d, err := s.viewPlaylist(r, p)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var in playlistInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	p, err := s.store.CreatePlaylist(r.Context(), &store.Playlist{UserID: auth.UserID(r.Context()), Name: in.Name,
		Description: in.Description, Level: in.Level, Visibility: in.Visibility})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) updatePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in playlistInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	p, err := s.store.UpdatePlaylist(r.Context(), &store.Playlist{ID: id, UserID: auth.UserID(r.Context()), Name: in.Name,
		Description: in.Description, Level: in.Level, Visibility: in.Visibility}, in.MakePublic)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeletePlaylist(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) addPlaylistTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		TopicID    int64 `json:"topicId"`
		MakePublic bool  `json:"makePublic"` // confirmed: publish a private topic added to a public playlist
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := s.store.AddPlaylistTopic(r.Context(), auth.UserID(r.Context()), id, in.TopicID, in.MakePublic); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removePlaylistTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	topicID, err := strconv.ParseInt(r.PathValue("topicId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "id không hợp lệ")
		return
	}
	if err := s.store.RemovePlaylistTopic(r.Context(), auth.UserID(r.Context()), id, topicID); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reorderPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		TopicIDs []int64 `json:"topicIds"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := s.store.ReorderPlaylist(r.Context(), auth.UserID(r.Context()), id, in.TopicIDs); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setFollow(follow bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathID(w, r)
		if !ok {
			return
		}
		err := s.store.SetFollow(r.Context(), auth.UserID(r.Context()), id, follow)
		if errors.Is(err, store.ErrConflict) {
			writeError(w, http.StatusConflict, "đây là playlist của bạn")
			return
		}
		if err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// topicPlaylists lists which of the user's playlists contain a topic.
func (s *Server) topicPlaylists(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ids, err := s.store.OwnPlaylistsWithTopic(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ids)
}

// ---- Listen -> Write ----

// gradeDictation grades a typed answer for one line and records the attempt.
func (s *Server) gradeDictation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Answer string `json:"answer"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Answer = strings.TrimSpace(in.Answer)
	if utf8.RuneCountInString(in.Answer) > 1000 {
		writeError(w, http.StatusBadRequest, "câu trả lời quá dài")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	item, _, err := s.store.GetItem(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	res := dictation.Grade(item.Text, in.Answer)
	if err := s.store.LogDictation(ctx, uid, item.ID, in.Answer, res.Score, res.Passed); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"score": res.Score, "passed": res.Passed, "tokens": res.Tokens,
		"reference": item.Text, "passScore": dictation.PassScore})
}

func (s *Server) writeParticipants(w http.ResponseWriter, ps []*store.Participant, err error) {
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for _, p := range ps {
		p.AvatarURL = s.imageURL(p.AvatarKey)
	}
	writeJSON(w, http.StatusOK, ps)
}

func (s *Server) playlistParticipants(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := s.store.GetPlaylist(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	ps, err := s.store.PlaylistParticipants(r.Context(), id)
	s.writeParticipants(w, ps, err)
}

func (s *Server) topicParticipants(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := s.store.GetTopic(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	ps, err := s.store.TopicParticipants(r.Context(), id)
	s.writeParticipants(w, ps, err)
}
