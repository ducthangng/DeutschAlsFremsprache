package api

import (
	"log"
	"net/http"
	"slices"
	"strconv"
	"time"

	"deutschfremsprache/internal/dictation"
	"deutschfremsprache/internal/store"
)

// ---- admin: learner activity and reviewing their work ----

var activityKinds = []string{"shadow", "write", "simulation", "create"}

const activityPageSize = 50

// GET /api/admin/activity?user=&kind=&offset= — learner sessions, newest first.
func (s *Server) adminActivity(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	q := r.URL.Query()
	f := store.ActivityFilter{Kind: q.Get("kind"), Limit: activityPageSize + 1}
	f.UserID, _ = strconv.ParseInt(q.Get("user"), 10, 64)
	f.Offset, _ = strconv.Atoi(q.Get("offset"))
	if (f.Kind != "" && !slices.Contains(activityKinds, f.Kind)) || f.Offset < 0 || f.UserID < 0 {
		writeError(w, http.StatusBadRequest, "tham số không hợp lệ")
		return
	}
	rows, err := s.store.ListActivity(r.Context(), f)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	more := len(rows) > activityPageSize
	if more {
		rows = rows[:activityPageSize]
	}
	for _, a := range rows {
		a.UserAvatarURL = s.imageURL(a.UserAvatarKey)
	}
	writeJSON(w, http.StatusOK, map[string]any{"activity": rows, "hasMore": more})
}

// GET /api/admin/review?user=&topic=&day=YYYY-MM-DD — every line of the topic
// with the learner's gradings, passed takes and dictation answers that day.
func (s *Server) adminReview(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	q := r.URL.Query()
	userID, err1 := strconv.ParseInt(q.Get("user"), 10, 64)
	topicID, err2 := strconv.ParseInt(q.Get("topic"), 10, 64)
	day, err3 := time.Parse(time.DateOnly, q.Get("day"))
	if err1 != nil || err2 != nil || err3 != nil {
		writeError(w, http.StatusBadRequest, "tham số không hợp lệ")
		return
	}
	lines, err := s.store.ReviewDay(r.Context(), userID, topicID, day)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// Re-grade dictation answers to show which words were wrong.
	for _, l := range lines {
		for i := range l.Dictation {
			l.Dictation[i].Tokens = dictation.Grade(l.Text, l.Dictation[i].Answer).Tokens
		}
	}
	writeJSON(w, http.StatusOK, lines)
}

// GET /api/admin/recordings/{id}/audio — any learner's take.
func (s *Server) adminRecordingAudio(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	rec, err := s.store.AdminRecording(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.streamRecording(w, r, rec)
}

// GET /api/admin/simulations/{id} — any learner's simulation, with signed
// URLs for the audio of each turn (keyed by turn id).
func (s *Server) adminSimulation(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	sim, err := s.store.AdminSimulation(ctx, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	turns, err := s.store.SimulationTurns(ctx, sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	costs, err := s.store.SimulationCosts(ctx, sim.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	audio := map[int64]string{}
	for _, t := range turns {
		if t.AudioKey == "" {
			continue
		}
		if u, err := s.media.URL(ctx, t.AudioKey, speechURLTTL); err == nil {
			audio[t.ID] = u
		} else {
			log.Printf("sign turn %d audio: %v", t.ID, err)
		}
	}
	sim.Scenario = publicScenario(sim.Scenario)
	writeJSON(w, http.StatusOK, map[string]any{
		"simulation": simulationDetail{Simulation: sim, Turns: turns, Costs: costs, VoiceGenerated: s.ttsEnabled(sim.Language)},
		"audioUrls":  audio,
	})
}
