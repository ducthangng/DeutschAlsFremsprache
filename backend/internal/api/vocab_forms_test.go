package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

// German words saved to the Pocket come back in card form: nouns with their
// article, finite verbs with their subject. English words are left alone.
func TestVocabCardForms(t *testing.T) {
	st := openTestStore(t)
	forms := map[string]string{"Zeitung": "die Zeitung", "liest": "liest (du)", "schnell": "schnell"}
	calls := 0
	oa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Messages []struct{ Content string }
		}
		json.Unmarshal(body, &req)
		prompt := req.Messages[len(req.Messages)-1].Content
		var terms []struct{ Term, Context string }
		json.Unmarshal([]byte(prompt[strings.Index(prompt, "Terms (JSON): ")+len("Terms (JSON): "):]), &terms)
		var items []map[string]string
		for _, x := range terms {
			if x.Term == "liest" && !strings.Contains(x.Context, "du") {
				t.Errorf("context sentence not sent: %+v", x)
			}
			items = append(items, map[string]string{"term": forms[x.Term]})
		}
		content, _ := json.Marshal(map[string]any{"items": items})
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}, "finish_reason": "stop"}},
			"usage":   map[string]int{"prompt_tokens": 200, "completion_tokens": 20},
		})
	}))
	defer oa.Close()
	server, err := New(context.Background(), config.Config{DataDir: t.TempDir(), JWTSecret: "x", OpenAIKey: "k", OpenAIBaseURL: oa.URL + "/v1",
		OpenAIChatModel: "gpt-4.1-mini", OpenAIChatUSDPerMIn: 0.4, OpenAIChatUSDPerMOut: 1.6}, st)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	c := other(t, srv.URL)

	var v store.VocabEntry
	if code := c.json("POST", "/api/vocab", map[string]any{"language": "de-DE", "term": "liest", "meaning": "đọc", "example": "Was liest du gerade?"}, &v); code != 201 || v.Term != "liest (du)" {
		t.Fatalf("verb: %d %q", code, v.Term)
	}
	var bulk struct {
		Added   []store.VocabEntry
		Skipped []string
	}
	c.json("POST", "/api/vocab/bulk", map[string]any{"language": "de-DE", "items": []map[string]string{
		{"term": "Zeitung", "meaning": "báo"}, {"term": "schnell", "meaning": "nhanh"}}}, &bulk)
	if len(bulk.Added) != 2 || bulk.Added[0].Term != "die Zeitung" || bulk.Added[1].Term != "schnell" {
		t.Fatalf("bulk: %+v", bulk)
	}
	// "die Zeitung" is already in the pocket: saving "Zeitung" again is a duplicate.
	if code := c.json("POST", "/api/vocab", map[string]any{"language": "de-DE", "term": "Zeitung", "meaning": "báo"}, nil); code != 409 {
		t.Errorf("duplicate after normalizing: %d", code)
	}
	before := calls
	if code := c.json("POST", "/api/vocab", map[string]any{"language": "en-US", "term": "reads", "meaning": "đọc"}, &v); code != 201 || v.Term != "reads" || calls != before {
		t.Errorf("english word: %d %q, %d calls", code, v.Term, calls-before)
	}
	// Editing a card keeps what the learner typed.
	if code := c.json("PUT", "/api/vocab/"+itoa(bulk.Added[1].ID), map[string]any{"term": "schnell", "meaning": "nhanh, mau"}, &v); code != 200 || v.Term != "schnell" || calls != before {
		t.Errorf("update: %d %q", code, v.Term)
	}
}
