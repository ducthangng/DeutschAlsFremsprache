package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

type client struct {
	t     *testing.T
	base  string
	token string
}

func (c *client) do(method, path string, body io.Reader, contentType string, out any) int {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+path, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func (c *client) raw(method, path string) *http.Response {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+path, nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	c.t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != 200 {
		c.t.Fatalf("%s %s: %d", method, path, resp.StatusCode)
	}
	return resp
}

func (c *client) json(method, path string, in, out any) int {
	b, _ := json.Marshal(in)
	return c.do(method, path, bytes.NewReader(b), "application/json", out)
}

func silentWAV(samples int) []byte {
	var b bytes.Buffer
	dataLen := uint32(samples * 2)
	b.WriteString("RIFF")
	binary.Write(&b, binary.LittleEndian, 36+dataLen)
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(16000), uint32(32000), uint16(2), uint16(16)} {
		binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	binary.Write(&b, binary.LittleEndian, dataLen)
	b.Write(make([]byte, dataLen))
	return b.Bytes()
}

func TestFlow(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "recordings"), 0o755)
	st := openTestStore(t)
	// PassThreshold 0 so the mock assessment always passes.
	server, err := New(context.Background(), config.Config{DataDir: dir, JWTSecret: "x", PassThreshold: 0, WordThreshold: 60, AdminUserID: 1}, st)
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeTranslator{}
	server.translator = fake
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	c := &client{t: t, base: srv.URL}

	if code := c.json("GET", "/api/topics", nil, nil); code != 401 {
		t.Fatalf("unauthenticated list: %d", code)
	}
	var auth authResponse
	if code := c.json("POST", "/api/auth/register", credentials{Email: "A@b.de", Password: "12345678"}, &auth); code != 201 || auth.Token == "" {
		t.Fatalf("register: %d", code)
	}
	if code := c.json("POST", "/api/auth/login", credentials{Email: "a@b.de", Password: "wrong"}, nil); code != 401 {
		t.Fatalf("bad login: %d", code)
	}
	if code := c.json("POST", "/api/auth/login", credentials{Email: "a@b.de", Password: "12345678"}, &auth); code != 200 {
		t.Fatalf("login: %d", code)
	}
	c.token = auth.Token

	var tp store.Topic
	in := topicInput{Title: "Am Bahnhof", Language: "de-DE", Kind: "dialogue", Content: "Anna: Wo ist Gleis 3?\nBen: Dort drüben. | Ở đằng kia"}
	if code := c.json("POST", "/api/topics", in, &tp); code != 201 || tp.ItemCount != 2 {
		t.Fatalf("create: %d %+v", code, tp)
	}

	var d struct {
		Speakers []string
		Items    []struct {
			ID         int64
			Recordings []store.Recording
		}
	}
	path := "/api/topics/" + itoa(tp.ID)
	c.json("GET", path, nil, &d)
	if len(d.Items) != 2 || len(d.Speakers) != 2 || d.Speakers[1] != "Ben" {
		t.Fatalf("detail: %+v", d)
	}

	// Translations are cached: the second request must not hit the provider.
	var tr translateResponse
	treq := translateRequest{Language: "de-DE", Texts: []string{"Hallo", "Danke", "Hallo"}}
	if code := c.json("POST", "/api/translate", treq, &tr); code != 200 || tr.Translations[0] != "vi:Hallo" || tr.Translations[2] != "vi:Hallo" || fake.calls != 1 || tr.Chars != 10 {
		t.Fatalf("translate: %d %+v calls=%d", code, tr, fake.calls)
	}
	c.json("POST", "/api/translate", treq, &tr)
	if fake.calls != 1 || tr.Chars != 0 || tr.Translations[1] != "vi:Danke" {
		t.Fatalf("translate cache: %+v calls=%d", tr, fake.calls)
	}

	// Vocabulary pocket: create, duplicate (case-insensitive), review, delete.
	var v store.VocabEntry
	if code := c.json("POST", "/api/vocab", vocabInput{Language: "de-DE", Term: "Gleis", Meaning: "sân ga", TopicID: &tp.ID}, &v); code != 201 || v.TopicID == nil || v.State != "new" || v.NextIn["good"] != 86400 {
		t.Fatalf("vocab create: %d %+v", code, v)
	}
	if code := c.json("POST", "/api/vocab", vocabInput{Language: "de-DE", Term: "gleis"}, nil); code != 409 {
		t.Fatalf("vocab duplicate: %d", code)
	}
	c.json("POST", "/api/vocab/"+itoa(v.ID)+"/review", map[string]int{"grade": 3, "durationMs": 4000}, &v)
	if v.Interval != 1 || v.Reps != 1 || v.Reviews != 1 || v.State != "young" || !v.DueAt.After(time.Now().Add(23*time.Hour)) {
		t.Fatalf("vocab review: %+v", v)
	}
	var vs []store.VocabEntry
	c.json("GET", "/api/vocab", nil, &vs)
	if len(vs) != 1 {
		t.Fatalf("vocab list: %+v", vs)
	}
	if code := other(t, srv.URL).json("DELETE", "/api/vocab/"+itoa(v.ID), nil, nil); code != 404 {
		t.Fatalf("foreign vocab delete: %d", code)
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("audio", "a.wav")
	fw.Write(silentWAV(16000))
	mw.Close()
	var res assessResponse
	if code := c.do("POST", "/api/items/"+itoa(d.Items[0].ID)+"/assess", &body, mw.FormDataContentType(), &res); code != 200 {
		t.Fatalf("assess: %d", code)
	}
	if !res.Passed || res.Recording == nil || !res.Mock || len(res.Tokens) != 4 {
		t.Fatalf("assess result: %+v", res)
	}
	if res.Usage.Provider != "mock" || res.Usage.AudioMs != 1000 || res.Usage.CostUSD != 0 {
		t.Fatalf("usage: %+v", res.Usage)
	}
	var u struct {
		Recent []store.RecentAssessment
		Month  store.UsagePeriod
	}
	c.json("GET", "/api/usage", nil, &u)
	if len(u.Recent) != 1 || u.Recent[0].ItemText != "Wo ist Gleis 3?" || u.Month.Gradings != 0 {
		// mock gradings are logged but excluded from billed totals
		t.Fatalf("usage endpoint: %+v", u)
	}
	if code := c.do("GET", "/api/recordings/"+itoa(res.Recording.ID)+"/audio", nil, "", nil); code != 200 {
		t.Fatalf("audio: %d", code)
	}

	// Downloads: a single take as an attachment, and the whole topic as a ZIP.
	resp := c.raw("GET", "/api/recordings/"+itoa(res.Recording.ID)+"/audio?download=1")
	if cd := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") || !strings.Contains(cd, "am-bahnhof-01-anna-wo-ist-gleis-3-") {
		t.Fatalf("download disposition: %q", cd)
	}
	resp = c.raw("GET", path+"/recordings.zip")
	zipBytes, _ := io.ReadAll(resp.Body)
	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil || len(zr.File) != 1 || !strings.HasPrefix(zr.File[0].Name, "am-bahnhof/01-anna-") {
		t.Fatalf("zip: %v %d", err, resp.StatusCode)
	}

	// Editing keeps recordings of unchanged lines.
	in.Content = "Ben: Dort drüben.\nAnna: Wo ist Gleis 3?\nAnna: Danke!"
	if code := c.json("PUT", path, in, nil); code != 200 {
		t.Fatalf("update: %d", code)
	}
	c.json("GET", path, nil, &d)
	if len(d.Items) != 3 || len(d.Items[1].Recordings) != 1 {
		t.Fatalf("after update: %+v", d)
	}

	// Another user cannot see the topic.
	other := &client{t: t, base: srv.URL}
	other.json("POST", "/api/auth/register", credentials{Email: "c@d.de", Password: "12345678"}, &auth)
	other.token = auth.Token
	if code := other.json("GET", path, nil, nil); code != 404 {
		t.Fatalf("foreign topic: %d", code)
	}

	if code := c.json("DELETE", path, nil, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if files := wavFiles(t, dir); len(files) != 0 {
		t.Fatalf("recording files left: %v", files)
	}
}

// openTestStore connects to TEST_DATABASE_URL inside a fresh schema that is
// dropped afterwards, so tests never touch the application's tables.
func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set (e.g. postgres://dfs:dfs@localhost:5432/deutschfremsprache?sslmode=disable)")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("test_%d", time.Now().UnixNano())
	if _, err := conn.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		conn.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		conn.Close(context.Background())
	})
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	st, err := store.Open(ctx, url+sep+"search_path="+schema)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	return st
}

type fakeTranslator struct{ calls int }

func (f *fakeTranslator) Name() string              { return "fake" }
func (f *fakeTranslator) CostUSD(chars int) float64 { return float64(chars) / 1e6 * 10 }
func (f *fakeTranslator) Translate(_ context.Context, _, _ string, texts []string) ([]string, error) {
	f.calls++
	out := make([]string, len(texts))
	for i, t := range texts {
		out[i] = "vi:" + t
	}
	return out, nil
}

// other registers a second user.
func other(t *testing.T, base string) *client {
	c := &client{t: t, base: base}
	var a authResponse
	c.json("POST", "/api/auth/register", credentials{Email: fmt.Sprintf("o%d@x.de", time.Now().UnixNano()), Password: "12345678"}, &a)
	c.token = a.Token
	return c
}

func TestWAVDuration(t *testing.T) {
	if ms := wavDurationMs(silentWAV(24000)); ms != 1500 {
		t.Fatalf("got %d", ms)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestSlug(t *testing.T) {
	for in, want := range map[string]string{
		"Ärztin: Grüß Gott!":  "aerztin-gruess-gott",
		"Chào buổi sáng, Đức": "chao-buoi-sang-duc",
		"  --- ":              "recording",
		"Wo ist Gleis 3?":     "wo-ist-gleis-3",
	} {
		if got := slug(in, 40); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

// wavFiles lists .wav files anywhere under dir (recordings live in media storage).
func wavFiles(t *testing.T, dir string) []string {
	var out []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".wav") {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestCORSAllowed(t *testing.T) {
	allowed := []string{"https://deutsch.example.com", "https://*.vercel.app"}
	for origin, want := range map[string]bool{
		"https://deutsch.example.com":        true,
		"https://my-app-git-main.vercel.app": true,
		"http://my-app.vercel.app":           false,
		"https://vercel.app.evil.com":        false,
		"https://evil.com":                   false,
	} {
		if got := corsAllowed(allowed, origin); got != want {
			t.Errorf("%s: got %v want %v", origin, got, want)
		}
	}
}

func TestParseOrigins(t *testing.T) {
	got := parseOrigins(` "https://speak.ducthang.dev/", speak.example.com ,*.vercel.app,`)
	want := []string{"https://speak.ducthang.dev", "https://speak.example.com", "https://*.vercel.app"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %v", got)
	}
	if !corsAllowed(got, "https://speak.ducthang.dev") || !corsAllowed(got, "https://x-git-main.vercel.app") {
		t.Fatal("expected allowed")
	}
}
