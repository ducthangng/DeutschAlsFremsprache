package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

// fakeOpenAI answers chat completions with a fixed script and audio/speech
// with one second of silent 24 kHz PCM.
func fakeOpenAI(t *testing.T, ttsCalls *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, `{"error":{"message":"bad key"}}`, 401)
			return
		}
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/v1/chat/completions":
			if !strings.Contains(string(body), "json_schema") || !strings.Contains(string(body), "Fahrkarte") {
				t.Errorf("unexpected chat request: %s", body)
			}
			script := `{"title":"Am Schalter","description":"Mua vé tàu","lines":[` +
				`{"speaker":"Anna","text":"Ich möchte eine Fahrkarte | bitte.","vietnamese":"Tôi muốn mua một vé."},` +
				`{"speaker":"Herr Weber:","text":"Wohin möchten Sie fahren?","vietnamese":"Chị muốn đi đâu?"}],` +
				`"vocabulary":[{"term":"die Fahrkarte","vietnamese":"vé tàu"}]}`
			json.NewEncoder(w).Encode(map[string]any{
				"model":   "gpt-test",
				"choices": []any{map[string]any{"message": map[string]any{"content": script}, "finish_reason": "stop"}},
				"usage":   map[string]int{"prompt_tokens": 1000, "completion_tokens": 500},
			})
		case "/v1/audio/speech":
			ttsCalls.Add(1)
			if !strings.Contains(string(body), `"response_format":"pcm"`) {
				t.Errorf("unexpected speech request: %s", body)
			}
			w.Write(make([]byte, 48000)) // 1 s of 24 kHz 16-bit mono
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestAIGenerationSpeechAndPublicTopics(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "recordings"), 0o755)
	st := openTestStore(t)
	var ttsCalls atomic.Int32
	oa := fakeOpenAI(t, &ttsCalls)
	defer oa.Close()
	server, err := New(context.Background(), config.Config{DataDir: dir, JWTSecret: "x", PassThreshold: 0, WordThreshold: 60,
		OpenAIKey: "test-key", OpenAIBaseURL: oa.URL + "/v1", OpenAIChatModel: "gpt-test", OpenAIChatUSDPerMIn: 1, OpenAIChatUSDPerMOut: 2,
		OpenAITTSModel: "gpt-4o-mini-tts", OpenAITTSUSDPerMinute: 0.6}, st)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	owner, learner := other(t, srv.URL), other(t, srv.URL)

	// 1. Generate a script; the cost is logged before a topic exists.
	var gen generateResponse
	code := owner.json("POST", "/api/generate/script", generateRequest{Language: "de-DE", SpeechType: "dialogue",
		Scenario: "Am Bahnhof", Vocabulary: []string{"die Fahrkarte"}, Level: "A2", Lines: 6}, &gen)
	if code != 200 || gen.GenerationID == 0 || gen.Usage.CostUSD != 0.002 {
		t.Fatalf("generate: %d %+v", code, gen)
	}
	wantContent := "Anna: Ich möchte eine Fahrkarte / bitte. | Tôi muốn mua một vé.\nHerr Weber: Wohin möchten Sie fahren? | Chị muốn đi đâu?\n"
	if gen.Content != wantContent || gen.Title != "Am Schalter" || len(gen.Vocabulary) != 1 {
		t.Fatalf("generated content: %q %+v", gen.Content, gen)
	}

	// 2. Create the (public) topic from it; script cost and vocabulary follow.
	var tp store.Topic
	code = owner.json("POST", "/api/topics", topicInput{Title: gen.Title, Language: "de-DE", Kind: gen.Kind, Visibility: "public",
		Content: gen.Content, GenerationIDs: []int64{gen.GenerationID}, Vocabulary: gen.Vocabulary}, &tp)
	if code != 201 || tp.TotalCost != 0.002 || tp.Visibility != "public" || !tp.IsOwner {
		t.Fatalf("create: %d %+v", code, tp)
	}
	var vocab []store.VocabEntry
	owner.json("GET", "/api/vocab", nil, &vocab)
	if len(vocab) != 1 || vocab[0].Term != "die Fahrkarte" || vocab[0].TopicID == nil {
		t.Fatalf("pocket: %+v", vocab)
	}

	// 3. Another user sees it publicly, can practice it, but cannot edit it.
	var pub []store.Topic
	learner.json("GET", "/api/topics/public", nil, &pub)
	if len(pub) != 1 || pub[0].OwnerName == "" || pub[0].IsOwner {
		t.Fatalf("public list: %+v", pub)
	}
	path := "/api/topics/" + itoa(tp.ID)
	var d struct {
		IsOwner bool
		Items   []struct {
			ID           int64
			SpeechCached *bool
		}
	}
	if code := learner.json("GET", path, nil, &d); code != 200 || d.IsOwner || d.Items[0].SpeechCached == nil || *d.Items[0].SpeechCached {
		t.Fatalf("learner detail: %d %+v", code, d)
	}
	if code := learner.json("PUT", path, topicInput{Title: "x", Language: "de-DE", Kind: "dialogue", Content: "A: x"}, nil); code != 404 {
		t.Fatalf("learner edit: %d", code)
	}
	if code := learner.json("PATCH", path+"/visibility", map[string]string{"visibility": "private"}, nil); code != 404 {
		t.Fatalf("learner visibility: %d", code)
	}

	// 4. Speech: generated once (by the learner, who pays), then re-used.
	var sp speechResponse
	itemPath := "/api/items/" + itoa(d.Items[0].ID) + "/speech"
	if code := learner.json("POST", itemPath, nil, &sp); code != 200 || sp.Cached || sp.DurationMs != 1000 || sp.CostUSD != 0.01 || sp.Voice != "coral" {
		t.Fatalf("speech generate: %d %+v", code, sp)
	}
	resp, err := http.Get(srv.URL + sp.URL)
	if err != nil || resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "audio/wav" {
		t.Fatalf("media: %v %v", err, resp)
	}
	resp.Body.Close()
	if resp, _ := http.Get(srv.URL + strings.Replace(sp.URL, "sig=", "sig=0", 1)); resp.StatusCode != 403 {
		t.Fatalf("tampered media url: %d", resp.StatusCode)
	}
	if code := owner.json("POST", itemPath, nil, &sp); code != 200 || !sp.Cached || sp.CostUSD != 0 {
		t.Fatalf("speech cached: %d %+v", code, sp)
	}
	if ttsCalls.Load() != 1 {
		t.Fatalf("tts calls: %d", ttsCalls.Load())
	}
	owner.json("GET", path, nil, &d)
	if !*d.Items[0].SpeechCached || *d.Items[1].SpeechCached {
		t.Fatalf("speechCached flags: %+v", d.Items)
	}

	// English topics get generated speech too (graded by Azure in en-US, like German in de-DE).
	var en store.Topic
	owner.json("POST", "/api/topics", topicInput{Title: "Job interview", Language: "en-US", Kind: "dialogue", Content: "A: Tell me about yourself."}, &en)
	var enDetail struct {
		Items []struct {
			ID           int64
			SpeechCached *bool
		}
	}
	owner.json("GET", "/api/topics/"+itoa(en.ID), nil, &enDetail)
	if enDetail.Items[0].SpeechCached == nil || *enDetail.Items[0].SpeechCached {
		t.Fatalf("english speech flag: %+v", enDetail)
	}
	if code := owner.json("POST", "/api/items/"+itoa(enDetail.Items[0].ID)+"/speech", nil, &sp); code != 200 || sp.Cached || ttsCalls.Load() != 2 {
		t.Fatalf("english speech: %d %+v calls=%d", code, sp, ttsCalls.Load())
	}

	// 5. Completion counter and per-person cost breakdown.
	if code := learner.json("POST", path+"/complete", nil, &tp); code != 200 || tp.Completions != 1 {
		t.Fatalf("complete: %d %+v", code, tp)
	}
	var costs []store.TopicCost
	owner.json("GET", path+"/costs", nil, &costs)
	if len(costs) != 2 || costs[0].TTSUSD != 0.01 || costs[1].ScriptUSD != 0.002 {
		t.Fatalf("costs: %+v", costs)
	}

	// 6. Private again: the learner loses access.
	owner.json("PATCH", path+"/visibility", map[string]string{"visibility": "private"}, nil)
	if code := learner.json("GET", path, nil, nil); code != 404 {
		t.Fatalf("private topic visible: %d", code)
	}
}
