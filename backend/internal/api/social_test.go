package api

import (
	"bytes"
	"mime/multipart"
	"testing"

	"deutschfremsprache/internal/store"
)

func TestPublicPlaylistRulesVocabAvatarsAdmin(t *testing.T) {
	_, srv, _ := newTestAPI(t)
	admin := other(t, srv.URL) // first user in the fresh schema: id 1
	owner, learner := other(t, srv.URL), other(t, srv.URL)

	// /usage is admin-only.
	if code := admin.json("GET", "/api/usage", nil, nil); code != 200 {
		t.Fatalf("admin usage: %d", code)
	}
	if code := owner.json("GET", "/api/usage", nil, nil); code != 403 {
		t.Fatalf("non-admin usage: %d", code)
	}
	var me store.User
	owner.json("GET", "/api/me", nil, &me)
	if me.IsAdmin {
		t.Fatal("owner flagged admin")
	}

	// A private topic + a public playlist.
	var tp store.Topic
	owner.json("POST", "/api/topics", topicInput{Title: "Café", Language: "de-DE", Kind: "dialogue",
		Content: "A: Einen Kaffee, bitte.\nB: Gern!", Vocabulary: []vocabSuggestion{{Term: "der Kaffee", Meaning: "cà phê"}}}, &tp)
	var pl store.Playlist
	owner.json("POST", "/api/playlists", playlistInput{Name: "Alltag", Visibility: "public"}, &pl)
	pp := "/api/playlists/" + itoa(pl.ID)

	// Adding a private topic needs confirmation, then publishes the topic.
	var conflict struct {
		Code    string
		Details []string
	}
	if code := owner.json("POST", pp+"/topics", map[string]any{"topicId": tp.ID}, &conflict); code != 409 || conflict.Code != "needs_public" || conflict.Details[0] != "Café" {
		t.Fatalf("add private topic: %d %+v", code, conflict)
	}
	if code := owner.json("POST", pp+"/topics", map[string]any{"topicId": tp.ID, "makePublic": true}, nil); code != 204 {
		t.Fatalf("add with makePublic: %d", code)
	}
	owner.json("GET", "/api/topics/"+itoa(tp.ID), nil, &tp)
	if tp.Visibility != "public" {
		t.Fatalf("topic not published: %s", tp.Visibility)
	}
	// ... and cannot go private while in the public playlist.
	if code := owner.json("PATCH", "/api/topics/"+itoa(tp.ID)+"/visibility", map[string]string{"visibility": "private"}, &conflict); code != 409 || conflict.Code != "in_public_playlist" {
		t.Fatalf("make private: %d %+v", code, conflict)
	}

	// Making a private playlist public needs confirmation for its private topics.
	var tp2 store.Topic
	owner.json("POST", "/api/topics", topicInput{Title: "Geheim", Language: "de-DE", Kind: "vocabulary", Content: "geheim"}, &tp2)
	var pl2 store.Playlist
	owner.json("POST", "/api/playlists", playlistInput{Name: "Privat"}, &pl2)
	owner.json("POST", "/api/playlists/"+itoa(pl2.ID)+"/topics", map[string]any{"topicId": tp2.ID}, nil)
	if code := owner.json("PUT", "/api/playlists/"+itoa(pl2.ID), playlistInput{Name: "Privat", Visibility: "public"}, &conflict); code != 409 || conflict.Code != "needs_public" {
		t.Fatalf("publish playlist: %d %+v", code, conflict)
	}
	if code := owner.json("PUT", "/api/playlists/"+itoa(pl2.ID), playlistInput{Name: "Privat", Visibility: "public", MakePublic: true}, nil); code != 200 {
		t.Fatalf("publish playlist confirmed: %d", code)
	}

	// Another learner copies the topic's vocabulary and picks words from the lines.
	var vocab []store.VocabEntry
	learner.json("GET", "/api/topics/"+itoa(tp.ID)+"/vocabulary", nil, &vocab)
	if len(vocab) != 1 || vocab[0].Term != "der Kaffee" {
		t.Fatalf("topic vocabulary: %+v", vocab)
	}
	var bulk struct {
		Added   []store.VocabEntry
		Skipped []string
	}
	items := []vocabInput{{Term: "der Kaffee", Meaning: "cà phê"}, {Term: "bitte", Example: "Einen Kaffee, bitte."}, {Term: "der Kaffee"}}
	if code := learner.json("POST", "/api/vocab/bulk", map[string]any{"language": "de-DE", "topicId": tp.ID, "items": items}, &bulk); code != 200 {
		t.Fatalf("bulk: %d", code)
	}
	if len(bulk.Added) != 2 || len(bulk.Skipped) != 1 || bulk.Added[1].Meaning == "" || bulk.Added[1].TopicID == nil {
		t.Fatalf("bulk result: %+v", bulk)
	}

	// Avatar upload, then participants show the learner who practiced.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("image", "me.png")
	fw.Write(pngBytes())
	mw.Close()
	var u store.User
	if code := learner.do("PUT", "/api/me/avatar", &body, mw.FormDataContentType(), &u); code != 200 || u.AvatarURL == "" {
		t.Fatalf("avatar: %d %+v", code, u)
	}
	var d struct{ Items []struct{ ID int64 } }
	learner.json("GET", "/api/topics/"+itoa(tp.ID), nil, &d)
	learner.json("POST", "/api/items/"+itoa(d.Items[0].ID)+"/dictation", map[string]string{"answer": "Einen Kaffee bitte"}, nil)
	learner.json("POST", pp+"/follow", nil, nil)
	var parts []store.Participant
	owner.json("GET", "/api/topics/"+itoa(tp.ID)+"/participants", nil, &parts)
	if len(parts) != 1 || parts[0].ID != u.ID || parts[0].AvatarURL == "" {
		t.Fatalf("topic participants: %+v", parts)
	}
	owner.json("GET", pp+"/participants", nil, &parts)
	if len(parts) != 1 {
		t.Fatalf("playlist participants: %+v", parts)
	}
	if code := learner.json("DELETE", "/api/me/avatar", nil, &u); code != 200 || u.AvatarURL != "" {
		t.Fatalf("remove avatar: %d %+v", code, u)
	}
}
