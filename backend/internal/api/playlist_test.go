package api

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

func newTestAPI(t *testing.T) (*Server, *httptest.Server, string) {
	dir := t.TempDir()
	server, err := New(context.Background(), config.Config{DataDir: dir, JWTSecret: "x", PassThreshold: 0, WordThreshold: 60, AdminUserID: 1}, openTestStore(t))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	t.Cleanup(srv.Close)
	return server, srv, dir
}

func pngBytes() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func TestPlaylistsDictationAndImages(t *testing.T) {
	_, srv, _ := newTestAPI(t)
	owner, follower := other(t, srv.URL), other(t, srv.URL)

	// Upload a cover picture; its signed URL serves the image without auth.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("image", "cover.png")
	fw.Write(pngBytes())
	mw.Close()
	var img struct{ Key, URL string }
	if code := owner.do("POST", "/api/images", &body, mw.FormDataContentType(), &img); code != 201 || !strings.HasPrefix(img.Key, "images/") {
		t.Fatalf("upload: %d %+v", code, img)
	}
	resp, _ := http.Get(srv.URL + img.URL)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("serve image: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if resp, _ := http.Get(srv.URL + strings.Replace(img.URL, "sig=", "sig=x", 1)); resp.StatusCode != 403 {
		t.Fatalf("bad signature: %d", resp.StatusCode)
	}

	// Two topics: one public with a cover and a line picture, one private.
	var pub, priv store.Topic
	owner.json("POST", "/api/topics", topicInput{Title: "Café", Language: "de-DE", Kind: "dialogue", Visibility: "public",
		CoverKey: img.Key, Images: []string{"", img.Key}, Content: "A: Einen Kaffee, bitte.\nB: Gern!"}, &pub)
	owner.json("POST", "/api/topics", topicInput{Title: "Secret", Language: "de-DE", Kind: "vocabulary", Content: "geheim"}, &priv)
	if pub.CoverURL == "" {
		t.Fatalf("cover url missing: %+v", pub)
	}
	if code := owner.json("POST", "/api/topics", topicInput{Title: "x", Language: "de-DE", Kind: "vocabulary", Content: "x", CoverKey: "../etc/passwd"}, nil); code != 400 {
		t.Fatalf("bad cover key accepted: %d", code)
	}

	// Playlist with both topics, published.
	var pl store.Playlist
	if code := owner.json("POST", "/api/playlists", playlistInput{Name: "Alltag A2", Level: "A2", Visibility: "public"}, &pl); code != 201 {
		t.Fatalf("create playlist: %d", code)
	}
	pp := "/api/playlists/" + itoa(pl.ID)
	for _, id := range []int64{pub.ID, pub.ID} { // adding twice is a no-op
		if code := owner.json("POST", pp+"/topics", map[string]int64{"topicId": id}, nil); code != 204 {
			t.Fatalf("add topic: %d", code)
		}
	}
	// A public playlist refuses private topics unless the owner confirms publishing them.
	if code := owner.json("POST", pp+"/topics", map[string]int64{"topicId": priv.ID}, nil); code != 409 {
		t.Fatalf("private topic in public playlist: %d", code)
	}
	var in []int64
	owner.json("GET", "/api/topics/"+itoa(pub.ID)+"/playlists", nil, &in)
	if len(in) != 1 || in[0] != pl.ID {
		t.Fatalf("topic playlists: %v", in)
	}
	if code := follower.json("POST", pp+"/topics", map[string]int64{"topicId": pub.ID}, nil); code != 404 {
		t.Fatalf("follower edited playlist: %d", code)
	}

	// The follower sees only the public topic, follows, and practices with Listen -> Write.
	var d playlistDetail
	follower.json("GET", pp, nil, &d)
	if len(d.Topics) != 1 || d.HiddenTopics != 0 || d.Progress.TopicsTotal != 1 || d.CoverURL == "" {
		t.Fatalf("follower view: %+v", d)
	}
	if code := follower.json("POST", pp+"/follow", nil, nil); code != 204 {
		t.Fatalf("follow: %d", code)
	}
	var mine []playlistView
	follower.json("GET", "/api/playlists", nil, &mine)
	if len(mine) != 1 || !mine[0].Following {
		t.Fatalf("followed list: %+v", mine)
	}

	var detail struct {
		Items []struct {
			ID       int64
			ImageURL string
		}
	}
	follower.json("GET", "/api/topics/"+itoa(pub.ID), nil, &detail)
	if detail.Items[0].ImageURL != "" || detail.Items[1].ImageURL == "" {
		t.Fatalf("line images: %+v", detail.Items)
	}
	var g struct {
		Score  float64
		Passed bool
		Tokens []struct{ Status string }
	}
	for i, ans := range []string{"Einen Kaffee bitte", "gern"} {
		follower.json("POST", "/api/items/"+itoa(detail.Items[i].ID)+"/dictation", map[string]string{"answer": ans}, &g)
	}
	if g.Score != 75 || g.Passed {
		t.Fatalf("dictation grade: %+v", g)
	}
	follower.json("POST", "/api/items/"+itoa(detail.Items[1].ID)+"/dictation", map[string]string{"answer": "Gern!"}, &g)
	d = playlistDetail{}
	follower.json("GET", pp, nil, &d)
	if d.Progress.TopicsDone != 1 || d.Progress.Percent != 100 || d.Topics[0].DictationPassedCount != 2 {
		t.Fatalf("progress: %+v / %+v", d.Progress, d.Topics[0])
	}

	// Unfollow; the owner deletes the playlist.
	follower.json("DELETE", pp+"/follow", nil, nil)
	follower.json("GET", "/api/playlists", nil, &mine)
	if len(mine) != 0 {
		t.Fatalf("after unfollow: %+v", mine)
	}
	if code := owner.json("DELETE", pp, nil, nil); code != 204 {
		t.Fatalf("delete playlist: %d", code)
	}
}

func TestMigrateLocalRecordings(t *testing.T) {
	server, srv, dir := newTestAPI(t)
	c := other(t, srv.URL)
	var tp store.Topic
	c.json("POST", "/api/topics", topicInput{Title: "x", Language: "de-DE", Kind: "vocabulary", Content: "Hallo Welt"}, &tp)
	var d struct{ Items []struct{ ID int64 } }
	c.json("GET", "/api/topics/"+itoa(tp.ID), nil, &d)

	// Simulate a recording saved by an older version: bare file name on local disk.
	os.MkdirAll(filepath.Join(dir, "recordings"), 0o755)
	os.WriteFile(filepath.Join(dir, "recordings", "old.wav"), silentWAV(1600), 0o644)
	rec := &store.Recording{ItemID: d.Items[0].ID, UserID: 0, FileName: "old.wav", Result: []byte("{}")}
	var me store.User
	c.json("GET", "/api/me", nil, &me)
	rec.UserID = me.ID
	if err := server.store.CreateRecording(context.Background(), rec); err != nil {
		t.Fatal(err)
	}

	server.MigrateLocalRecordings(context.Background())
	if _, err := os.Stat(filepath.Join(dir, "recordings", "old.wav")); !os.IsNotExist(err) {
		t.Fatal("local copy not removed")
	}
	if code := c.do("GET", "/api/recordings/"+itoa(rec.ID)+"/audio", nil, "", nil); code != 200 {
		t.Fatalf("migrated recording not served: %d", code)
	}
	if legacy, _ := server.store.LegacyRecordings(context.Background()); len(legacy) != 0 {
		t.Fatalf("still legacy: %v", legacy)
	}
}
