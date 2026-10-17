package api

import (
	"bytes"
	"mime/multipart"
	"testing"

	"deutschfremsprache/internal/store"
)

func TestAdminCosts(t *testing.T) {
	_, srv, _ := newTestAPI(t)
	admin := other(t, srv.URL) // id 1
	learner := other(t, srv.URL)

	var d struct {
		ID    int64
		Items []struct{ ID int64 }
	}
	learner.json("POST", "/api/topics", topicInput{Title: "Café", Language: "de-DE", Kind: "dialogue", Content: "A: Einen Kaffee, bitte."}, &d)
	learner.json("GET", "/api/topics/"+itoa(d.ID), nil, &d)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("audio", "a.wav")
	fw.Write(silentWAV(16000))
	mw.Close()
	if code := learner.do("POST", "/api/items/"+itoa(d.Items[0].ID)+"/assess", &body, mw.FormDataContentType(), nil); code != 200 {
		t.Fatalf("assess: %d", code)
	}

	if code := learner.json("GET", "/api/usage/costs", nil, nil); code != 403 {
		t.Fatalf("non-admin costs: %d", code)
	}
	if code := learner.json("GET", "/api/usage/requests", nil, nil); code != 403 {
		t.Fatalf("non-admin requests: %d", code)
	}

	var ov struct {
		Totals []store.CostKindTotal
		Users  []store.UserCost
		Topics []store.TopicSpend
	}
	if code := admin.json("GET", "/api/usage/costs?period=all", nil, &ov); code != 200 {
		t.Fatalf("costs: %d", code)
	}
	if len(ov.Totals) != 1 || ov.Totals[0].Kind != "assess" || ov.Totals[0].Requests != 1 {
		t.Fatalf("totals: %+v", ov.Totals)
	}
	if len(ov.Users) != 1 || ov.Users[0].Requests != 1 || ov.Users[0].Name == "" {
		t.Fatalf("by user: %+v", ov.Users)
	}
	if len(ov.Topics) != 1 || ov.Topics[0].Scope != "topic" || ov.Topics[0].TopicID != d.ID || ov.Topics[0].Title != "Café" || ov.Topics[0].Users != 1 {
		t.Fatalf("by topic: %+v", ov.Topics)
	}

	var log struct {
		Requests []store.CostEvent
		HasMore  bool
	}
	admin.json("GET", "/api/usage/requests?period=all&scope=topic&topic="+itoa(d.ID), nil, &log)
	if len(log.Requests) != 1 || log.Requests[0].Detail != "Einen Kaffee, bitte." || log.Requests[0].TopicTitle != "Café" || log.HasMore {
		t.Fatalf("requests: %+v", log)
	}
	admin.json("GET", "/api/usage/requests?period=all&kind=tts", nil, &log)
	if len(log.Requests) != 0 {
		t.Fatalf("kind filter: %+v", log.Requests)
	}
	if code := admin.json("GET", "/api/usage/requests?period=year", nil, nil); code != 400 {
		t.Fatalf("bad period: %d", code)
	}
}

func TestAdminActivityReview(t *testing.T) {
	_, srv, _ := newTestAPI(t)
	admin := other(t, srv.URL) // id 1
	learner := other(t, srv.URL)

	var d struct {
		ID    int64
		Items []struct{ ID int64 }
	}
	learner.json("POST", "/api/topics", topicInput{Title: "Café", Language: "de-DE", Kind: "dialogue", Content: "A: Einen Kaffee, bitte.\nB: Gern!"}, &d)
	learner.json("GET", "/api/topics/"+itoa(d.ID), nil, &d)
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("audio", "a.wav")
	fw.Write(silentWAV(16000))
	mw.Close()
	if code := learner.do("POST", "/api/items/"+itoa(d.Items[0].ID)+"/assess", &body, mw.FormDataContentType(), nil); code != 200 {
		t.Fatalf("assess: %d", code)
	}
	learner.json("POST", "/api/items/"+itoa(d.Items[1].ID)+"/dictation", map[string]string{"answer": "gern"}, nil)

	if code := learner.json("GET", "/api/admin/activity", nil, nil); code != 403 {
		t.Fatalf("non-admin activity: %d", code)
	}
	var feed struct {
		Activity []store.Activity
		HasMore  bool
	}
	if code := admin.json("GET", "/api/admin/activity", nil, &feed); code != 200 {
		t.Fatalf("activity: %d", code)
	}
	kinds := map[string]store.Activity{}
	for _, a := range feed.Activity {
		kinds[a.Kind] = a
	}
	sh, wr := kinds["shadow"], kinds["write"]
	if len(feed.Activity) != 3 || kinds["create"].TopicTitle != "Café" || sh.Attempts != 1 || sh.TopicLines != 2 || wr.Attempts != 1 || sh.Day == "" {
		t.Fatalf("feed: %+v", feed.Activity)
	}
	admin.json("GET", "/api/admin/activity?kind=write", nil, &feed)
	if len(feed.Activity) != 1 {
		t.Fatalf("kind filter: %+v", feed.Activity)
	}

	var lines []store.ReviewLine
	if code := admin.json("GET", "/api/admin/review?user="+itoa(sh.UserID)+"&topic="+itoa(d.ID)+"&day="+sh.Day, nil, &lines); code != 200 {
		t.Fatalf("review: %d", code)
	}
	if len(lines) != 2 || len(lines[0].Attempts) != 1 || len(lines[0].Recordings) != 1 || len(lines[1].Dictation) != 1 || lines[1].Dictation[0].Answer != "gern" {
		t.Fatalf("review lines: %+v", lines)
	}
	if code := admin.do("GET", "/api/admin/recordings/"+itoa(lines[0].Recordings[0].ID)+"/audio", nil, "", nil); code != 200 {
		t.Fatalf("admin audio: %d", code)
	}
	if code := learner.do("GET", "/api/admin/recordings/"+itoa(lines[0].Recordings[0].ID)+"/audio", nil, "", nil); code != 403 {
		t.Fatalf("non-admin audio: %d", code)
	}
}
