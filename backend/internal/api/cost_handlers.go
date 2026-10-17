package api

import (
	"net/http"
	"slices"
	"strconv"
	"time"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
)

// ---- app-wide costs (admin only) ----

// costSince turns ?period= into a start time: "month" (default), "7d", "today" or "all".
func costSince(period string) (time.Time, bool) {
	now := time.Now()
	switch period {
	case "", "month":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()), true
	case "7d":
		return now.AddDate(0, 0, -7), true
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), true
	case "all":
		return time.Time{}, true
	}
	return time.Time{}, false
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !s.isAdmin(auth.UserID(r.Context())) {
		writeError(w, http.StatusForbidden, "chỉ quản trị viên xem được trang chi phí")
		return false
	}
	return true
}

// costOverview: GET /api/usage/costs?period= — totals by kind, by user and by topic.
func (s *Server) costOverview(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	since, ok := costSince(r.URL.Query().Get("period"))
	if !ok {
		writeError(w, http.StatusBadRequest, "khoảng thời gian không hợp lệ")
		return
	}
	ctx := r.Context()
	totals, err := s.store.CostTotals(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	users, err := s.store.CostByUser(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for i := range users {
		users[i].AvatarURL = s.imageURL(users[i].AvatarKey)
	}
	topics, err := s.store.CostByTopic(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"since": since, "totals": totals, "users": users, "topics": topics})
}

var costKinds = []string{"assess", "script", "tts", "image", "simulation", "translate"}

const costPageSize = 50

// costRequests: GET /api/usage/requests?period=&user=&kind=&scope=&topic=&offset=
// — the request log, newest first.
func (s *Server) costRequests(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	q := r.URL.Query()
	since, ok := costSince(q.Get("period"))
	f := store.CostEventFilter{Since: since, Kind: q.Get("kind"), Scope: q.Get("scope"), Limit: costPageSize + 1}
	f.UserID, _ = strconv.ParseInt(q.Get("user"), 10, 64)
	f.TopicID, _ = strconv.ParseInt(q.Get("topic"), 10, 64)
	f.Offset, _ = strconv.Atoi(q.Get("offset"))
	switch {
	case !ok:
		writeError(w, http.StatusBadRequest, "khoảng thời gian không hợp lệ")
		return
	case f.Kind != "" && !slices.Contains(costKinds, f.Kind):
		writeError(w, http.StatusBadRequest, "loại request không hợp lệ")
		return
	case f.Scope != "" && f.Scope != "topic" && f.Scope != "simulation" && f.Scope != "none":
		writeError(w, http.StatusBadRequest, "phạm vi không hợp lệ")
		return
	case f.Offset < 0 || f.UserID < 0 || f.TopicID < 0:
		writeError(w, http.StatusBadRequest, "tham số không hợp lệ")
		return
	}
	events, err := s.store.CostEvents(r.Context(), f)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	more := len(events) > costPageSize
	if more {
		events = events[:costPageSize]
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": events, "hasMore": more})
}
