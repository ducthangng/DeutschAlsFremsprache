package api

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/srs"
	"deutschfremsprache/internal/store"
	"deutschfremsprache/internal/topic"
)

type vocabInput struct {
	Language string `json:"language"`
	Term     string `json:"term"`
	Meaning  string `json:"meaning"`
	Example  string `json:"example"`
	TopicID  *int64 `json:"topicId"`
	ImageKey string `json:"imageKey"`
}

func (in *vocabInput) validate() string {
	in.Term = strings.TrimSpace(in.Term)
	in.Meaning = strings.TrimSpace(in.Meaning)
	in.Example = strings.TrimSpace(in.Example)
	switch {
	case in.Term == "" || utf8.RuneCountInString(in.Term) > 200:
		return "từ/cụm từ cần từ 1 đến 200 ký tự"
	case utf8.RuneCountInString(in.Meaning) > 1000 || utf8.RuneCountInString(in.Example) > 1000:
		return "nghĩa và ví dụ tối đa 1000 ký tự"
	case !validImageKey(in.ImageKey):
		return "ảnh không hợp lệ"
	}
	return ""
}

func (s *Server) decorateVocab(vs ...*store.VocabEntry) {
	for _, v := range vs {
		v.ImageURL = s.imageURL(v.ImageKey)
	}
}

func (s *Server) listVocab(w http.ResponseWriter, r *http.Request) {
	vs, err := s.store.ListVocab(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(vs...)
	writeJSON(w, http.StatusOK, vs)
}

func (s *Server) createVocab(w http.ResponseWriter, r *http.Request) {
	var in vocabInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if !topic.Languages[in.Language] {
		writeError(w, http.StatusBadRequest, "ngôn ngữ không được hỗ trợ")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if in.TopicID != nil {
		if _, err := s.store.GetTopic(ctx, uid, *in.TopicID); err != nil {
			in.TopicID = nil // not readable by the user: keep the card, drop the link
		}
	}
	v, err := s.store.CreateVocab(ctx, uid, &store.VocabEntry{Language: in.Language, Term: in.Term, Meaning: in.Meaning,
		Example: in.Example, TopicID: in.TopicID, ImageKey: in.ImageKey})
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "từ này đã có trong Vocabulary Pocket")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(v)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) updateVocab(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in vocabInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if msg := in.validate(); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	v, err := s.store.UpdateVocab(r.Context(), auth.UserID(r.Context()), &store.VocabEntry{ID: id, Term: in.Term, Meaning: in.Meaning,
		Example: in.Example, ImageKey: in.ImageKey})
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "từ này đã có trong Vocabulary Pocket")
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(v)
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) deleteVocab(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteVocab(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// reviewVocab records an answer (1 again, 2 hard, 3 good, 4 easy) and reschedules the card.
func (s *Server) reviewVocab(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Grade      int `json:"grade"`
		DurationMs int `json:"durationMs"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Grade < 1 || in.Grade > 4 {
		writeError(w, http.StatusBadRequest, "grade phải từ 1 đến 4")
		return
	}
	in.DurationMs = min(max(in.DurationMs, 0), 10*60*1000)
	v, err := s.store.ReviewVocab(r.Context(), auth.UserID(r.Context()), id, srs.Grade(in.Grade), in.DurationMs)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(v)
	writeJSON(w, http.StatusOK, v)
}

// generateVocabImage draws a picture for a flashcard with OpenAI and stores it.
func (s *Server) generateVocabImage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if !s.openai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "máy chủ chưa cấu hình OPENAI_API_KEY")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	v, err := s.store.GetVocab(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	img, err := s.openai.GenerateImage(ctx, s.cfg.OpenAIImageModel, s.cfg.OpenAIImageUSD, v.Term, v.Meaning, v.Language)
	if err != nil {
		log.Printf("generate image: %v", err)
		writeError(w, http.StatusBadGateway, "không tạo được ảnh: "+err.Error())
		return
	}
	if _, err := s.store.LogAIUsage(ctx, store.AIUsage{UserID: uid, Kind: "image", Model: img.Model, CostUSD: img.CostUSD}); err != nil {
		log.Printf("log image usage: %v", err)
	}
	key, err := s.putImage(r, img.PNG)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if v, err = s.store.SetVocabImage(ctx, uid, id, key); err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(v)
	writeJSON(w, http.StatusOK, map[string]any{"entry": v, "costUsd": img.CostUSD})
}

// ---- statistics ----

type dayStat struct {
	Date       string `json:"date"` // YYYY-MM-DD, user's local day
	Reviews    int    `json:"reviews"`
	Remembered int    `json:"remembered"`
}

type vocabStats struct {
	Total         int            `json:"total"`
	DueNow        int            `json:"dueNow"`
	States        map[string]int `json:"states"` // new, learning, young, mature
	Streak        int            `json:"streak"` // consecutive days with reviews, ending today or yesterday
	BestStreak    int            `json:"bestStreak"`
	ReviewedToday int            `json:"reviewedToday"`
	MinutesToday  float64        `json:"minutesToday"`
	Retention30   *float64       `json:"retention30"` // % remembered in the last 30 days
	TotalReviews  int            `json:"totalReviews"`
	TotalMinutes  float64        `json:"totalMinutes"`
	Days          []dayStat      `json:"days"`     // last 30 days, oldest first
	Forecast      []dayStat      `json:"forecast"` // due cards for the next 7 days (Reviews = due count); today includes overdue
}

// vocabStats summarizes the user's flashcard practice. ?tz is the browser's
// offset in minutes east of UTC (e.g. 420 for Vietnam).
func (s *Server) vocabStats(w http.ResponseWriter, r *http.Request) {
	tz, _ := strconv.Atoi(r.URL.Query().Get("tz"))
	tz = min(max(tz, -14*60), 14*60)
	ctx, uid := r.Context(), auth.UserID(r.Context())
	cards, err := s.store.ListVocab(ctx, uid)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	days, err := s.store.ReviewDays(ctx, uid, tz)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, computeStats(cards, days, time.Now(), tz))
}

func computeStats(cards []*store.VocabEntry, days []store.ReviewDay, now time.Time, tz int) vocabStats {
	loc := time.FixedZone("user", tz*60)
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	key := func(t time.Time) string { return t.Format("2006-01-02") }

	st := vocabStats{Total: len(cards), States: map[string]int{"new": 0, "learning": 0, "young": 0, "mature": 0}}
	forecast := make([]int, 7)
	for _, c := range cards {
		st.States[c.State]++
		if !c.DueAt.After(now) {
			st.DueNow++
		}
		due := c.DueAt.In(loc)
		d := int(time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, time.UTC).Sub(today).Hours() / 24)
		if d < 0 {
			d = 0
		}
		if d < 7 {
			forecast[d]++
		}
	}
	for i, n := range forecast {
		st.Forecast = append(st.Forecast, dayStat{Date: key(today.AddDate(0, 0, i)), Reviews: n})
	}

	byDay := map[string]store.ReviewDay{}
	var rem30, rev30 int
	for _, d := range days {
		byDay[key(d.Day)] = d
		st.TotalReviews += d.Reviews
		st.TotalMinutes += float64(d.DurationMs) / 60000
		if !d.Day.Before(today.AddDate(0, 0, -29)) {
			rev30 += d.Reviews
			rem30 += d.Remembered
		}
	}
	for i := 29; i >= 0; i-- {
		d := byDay[key(today.AddDate(0, 0, -i))]
		st.Days = append(st.Days, dayStat{Date: key(today.AddDate(0, 0, -i)), Reviews: d.Reviews, Remembered: d.Remembered})
	}
	if t, ok := byDay[key(today)]; ok {
		st.ReviewedToday = t.Reviews
		st.MinutesToday = float64(t.DurationMs) / 60000
	}
	if rev30 > 0 {
		r := float64(int(float64(rem30)/float64(rev30)*1000)) / 10
		st.Retention30 = &r
	}

	// Current streak: today counts if done; otherwise it may still end yesterday.
	day := today
	if byDay[key(day)].Reviews == 0 {
		day = day.AddDate(0, 0, -1)
	}
	for byDay[key(day)].Reviews > 0 {
		st.Streak++
		day = day.AddDate(0, 0, -1)
	}
	run := 0
	var prev time.Time
	for _, d := range days {
		if !prev.IsZero() && d.Day.Sub(prev) == 24*time.Hour {
			run++
		} else {
			run = 1
		}
		st.BestStreak = max(st.BestStreak, run)
		prev = d.Day
	}
	return st
}

// topicVocabulary lists the topic owner's word list for the topic, so other
// learners can copy it into their own pocket.
func (s *Server) topicVocabulary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if _, err := s.store.GetTopic(r.Context(), auth.UserID(r.Context()), id); err != nil {
		writeStoreError(w, err)
		return
	}
	vs, err := s.store.TopicOwnerVocab(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for i := range vs {
		vs[i].ImageURL = s.imageURL(vs[i].ImageKey)
	}
	writeJSON(w, http.StatusOK, vs)
}

// bulkAddVocab adds several words at once; missing meanings are translated,
// terms already in the pocket are skipped.
func (s *Server) bulkAddVocab(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Language string       `json:"language"`
		TopicID  *int64       `json:"topicId"`
		Items    []vocabInput `json:"items"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !topic.Languages[in.Language] || len(in.Items) == 0 || len(in.Items) > 100 {
		writeError(w, http.StatusBadRequest, "cần từ 1 đến 100 từ, ngôn ngữ hợp lệ")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if in.TopicID != nil {
		if _, err := s.store.GetTopic(ctx, uid, *in.TopicID); err != nil {
			in.TopicID = nil
		}
	}
	var toTranslate []string
	for i := range in.Items {
		if msg := in.Items[i].validate(); msg != "" {
			writeError(w, http.StatusBadRequest, in.Items[i].Term+": "+msg)
			return
		}
		if in.Items[i].Meaning == "" {
			toTranslate = append(toTranslate, in.Items[i].Term)
		}
	}
	if len(toTranslate) > 0 {
		if tr, err := s.translateCached(ctx, uid, in.Language, toTranslate); err == nil {
			j := 0
			for i := range in.Items {
				if in.Items[i].Meaning == "" {
					in.Items[i].Meaning = tr.Translations[j]
					j++
				}
			}
		} else {
			log.Printf("bulk vocab translate: %v", err) // keep the words, without meanings
		}
	}
	res := struct {
		Added   []*store.VocabEntry `json:"added"`
		Skipped []string            `json:"skipped"` // already in the pocket
	}{Added: []*store.VocabEntry{}, Skipped: []string{}}
	for _, it := range in.Items {
		v, err := s.store.CreateVocab(ctx, uid, &store.VocabEntry{Language: in.Language, Term: it.Term, Meaning: it.Meaning,
			Example: it.Example, TopicID: in.TopicID, ImageKey: it.ImageKey})
		if errors.Is(err, store.ErrConflict) {
			res.Skipped = append(res.Skipped, it.Term)
			continue
		}
		if err != nil {
			writeStoreError(w, err)
			return
		}
		s.decorateVocab(v)
		res.Added = append(res.Added, v)
	}
	writeJSON(w, http.StatusOK, res)
}
