package api

import (
	"math"
	"net/http"
	"time"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
)

// Speaking-time milestones (seconds), ending with the famous 10,000 hours.
var speakingMilestones = []int64{
	10 * 60, 30 * 60, 3600, 2 * 3600, 5 * 3600, 10 * 3600, 20 * 3600, 50 * 3600,
	100 * 3600, 200 * 3600, 500 * 3600, 1000 * 3600, 2000 * 3600, 5000 * 3600, 10000 * 3600,
}

const tenThousandHours = 10000 * 3600

type rankBucket struct {
	From  int `json:"from"` // score range [from, from+5)
	Users int `json:"users"`
}

type ranking struct {
	AvgScore   *float64     `json:"avgScore"`   // nil until the user has been graded
	Position   int          `json:"position"`   // 1 = best
	Users      int          `json:"users"`      // graded users
	TopPercent int          `json:"topPercent"` // "top X%"
	Buckets    []rankBucket `json:"buckets"`    // distribution of averages, 20 buckets of 5 points
}

// buildRanking places the user among everyone's average scores.
func buildRanking(avgs map[int64]float64, uid int64) ranking {
	r := ranking{Users: len(avgs), Buckets: make([]rankBucket, 20)}
	for i := range r.Buckets {
		r.Buckets[i].From = i * 5
	}
	for _, a := range avgs {
		r.Buckets[min(19, max(0, int(a/5)))].Users++
	}
	mine, ok := avgs[uid]
	if !ok {
		return r
	}
	v := math.Round(mine*10) / 10
	r.AvgScore = &v
	r.Position = 1
	for id, a := range avgs {
		if id != uid && a > mine {
			r.Position++
		}
	}
	r.TopPercent = int(math.Ceil(float64(r.Position) / float64(r.Users) * 100))
	return r
}

type completionSummary struct {
	Session struct {
		SpeakingSec       float64 `json:"speakingSec"`
		AvgScore          float64 `json:"avgScore"`
		Gradings          int     `json:"gradings"`
		DictationAvg      float64 `json:"dictationAvg"`
		DictationAttempts int     `json:"dictationAttempts"`
	} `json:"session"`
	Speaking struct {
		TotalSec    float64 `json:"totalSec"`
		GoalSec     int64   `json:"goalSec"`     // next milestone
		TenKPercent float64 `json:"tenKPercent"` // progress toward 10,000 hours
	} `json:"speaking"`
	NewWords []*store.VocabEntry `json:"newWords"`
	Rank     ranking             `json:"rank"`
}

// topicSummary powers the congratulations popup after finishing a topic.
// ?since is when the practice session started (RFC 3339, at most 24 h ago).
func (s *Server) topicSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if _, err := s.store.GetTopic(ctx, uid, id); err != nil {
		writeStoreError(w, err)
		return
	}
	since, err := time.Parse(time.RFC3339, r.URL.Query().Get("since"))
	if err != nil || time.Since(since) > 24*time.Hour {
		since = time.Now().Add(-24 * time.Hour)
	}

	var out completionSummary
	sess, err := s.store.SessionStats(ctx, uid, id, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	out.Session.SpeakingSec = float64(sess.SpeakingMs) / 1000
	out.Session.AvgScore = math.Round(sess.AvgScore*10) / 10
	out.Session.Gradings = sess.Gradings
	out.Session.DictationAvg = math.Round(sess.DictationAvg*10) / 10
	out.Session.DictationAttempts = sess.DictationAttempts

	total, err := s.store.TotalSpeakingMs(ctx, uid)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	out.Speaking.TotalSec = float64(total) / 1000
	out.Speaking.GoalSec = speakingMilestones[len(speakingMilestones)-1]
	for _, m := range speakingMilestones {
		if total/1000 < m {
			out.Speaking.GoalSec = m
			break
		}
	}
	out.Speaking.TenKPercent = math.Round(float64(total)/1000/tenThousandHours*100*10000) / 10000

	if out.NewWords, err = s.store.VocabAddedSince(ctx, uid, since); err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorateVocab(out.NewWords...)

	avgs, err := s.store.UserAverageScores(ctx)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	out.Rank = buildRanking(avgs, uid)
	writeJSON(w, http.StatusOK, out)
}
