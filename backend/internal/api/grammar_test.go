package api

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/openai"
	"deutschfremsprache/internal/speech"
	"deutschfremsprache/internal/store"
)

// fakeGrammarChat answers each grammar call by its JSON schema name.
func fakeGrammarChat(t *testing.T) *httptest.Server {
	answers := map[string]string{
		"grammar_core": `{"title":"Konjunktiv II","overview":"Dùng để nói điều ước.","multipleChoice":[` +
			`{"question":"Wenn ich Zeit ___, käme ich.","options":["hätte","habe","hatte","haben"],"answer":0,"explanation":"Konjunktiv II của haben"},` +
			`{"question":"broken","options":["a","b"],"answer":7,"explanation":""}]}`,
		"grammar_rearrange": `{"items":[{"answer":"Ich würde gern kommen.","fragments":["Ich","würde","gern","kommen"],"alternatives":["Gern würde ich kommen."],"translation":"Tôi rất muốn đến.","explanation":"Động từ ở vị trí 2"}]}`,
		"grammar_reading":   `{"title":"Ein Traum","passage":"Wenn ich reich wäre, würde ich reisen.","questions":[{"question":"Was würde er tun?","options":["reisen","arbeiten","schlafen","kochen"],"answer":0,"explanation":"…"}]}`,
		"grammar_listening": `{"title":"Im Café","situation":"Hai người bạn nói chuyện.","speakers":[{"name":"Lena","gender":"female"},{"name":"Jonas","gender":"male"}],` +
			`"segments":[{"speaker":"Lena","text":"Ich hätte gern einen Kaffee."},{"speaker":"Jonas","text":"Ich würde lieber Tee trinken."}],"questions":[` +
			`{"kind":"choice","question":"Was möchte Lena?","options":["Kaffee","Tee","Wasser","Saft"],"answer":0,"accepted":[],"explanation":""},` +
			`{"kind":"blank","question":"Ich ___ lieber Tee trinken.","options":["x"],"answer":3,"accepted":["würde"],"explanation":""},` +
			`{"kind":"blank","question":"no gap here","options":[],"answer":-1,"accepted":["x"],"explanation":""}]}`,
		"grammar_writing": `{"items":[{"english":"I would like a coffee.","german":"Ich hätte gern einen Kaffee.","alternatives":[],"hint":"hätte gern"},` +
			`{"english":"If I were rich, I would travel.","german":"Wenn ich reich wäre, würde ich reisen.","alternatives":[],"hint":"wäre"}]}`,
		"writing_feedback": `{"items":[{"score":10,"verdict":"correct","corrected":"Ich hätte gern einen Kaffee.","feedback":"Đúng."},` +
			`{"score":14,"verdict":"wrong","corrected":"Wenn ich reich wäre, würde ich reisen.","feedback":"Thiếu wäre."}]}`,
	}
	nameRE := regexp.MustCompile(`"name":"([a-z_]+)"`)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Model           string `json:"model"`
			ReasoningEffort string `json:"reasoning_effort"`
		}
		json.Unmarshal(body, &req)
		if req.Model != "gpt-5.1" || req.ReasoningEffort != "low" {
			t.Errorf("model %q, reasoning %q", req.Model, req.ReasoningEffort)
		}
		m := nameRE.FindSubmatch(body)
		if m == nil || answers[string(m[1])] == "" {
			t.Errorf("unexpected chat request: %s", body)
			http.Error(w, "unexpected", 500)
			return
		}
		// Exercises are built around the learner's own words (sent with the set below).
		if strings.HasPrefix(string(m[1]), "grammar_") && !strings.Contains(string(body), "Kaffee; Reise") {
			t.Errorf("%s prompt lacks the deduplicated words", m[1])
		}
		if strings.HasPrefix(string(m[1]), "grammar_") && !strings.Contains(string(body), "own list") {
			t.Errorf("%s prompt lacks the learner's words", m[1])
		}
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": answers[string(m[1])]}, "finish_reason": "stop"}},
			"usage":   map[string]int{"prompt_tokens": 1000, "completion_tokens": 500},
		})
	}))
}

func TestGrammarSets(t *testing.T) {
	st := openTestStore(t)
	oa := fakeGrammarChat(t)
	defer oa.Close()
	server, err := New(context.Background(), config.Config{DataDir: t.TempDir(), JWTSecret: "x", OpenAIKey: "k", OpenAIBaseURL: oa.URL + "/v1"}, st)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	c, intruder := other(t, srv.URL), other(t, srv.URL)

	var models struct {
		Models       []openai.Model
		DefaultModel string
		Enabled      bool
	}
	if c.json("GET", "/api/grammar/models", nil, &models); !models.Enabled || models.DefaultModel != "gpt-5.1" || len(models.Models) < 3 {
		t.Fatalf("models: %+v", models)
	}

	req := func(sections openai.GrammarSections, model string) map[string]any {
		return map[string]any{"grammar": "Konjunktiv II", "level": "B1", "model": model, "sections": sections}
	}
	all := openai.GrammarSections{MultipleChoice: 5, Rearrange: 3, Reading: 2, Listening: 4, Writing: 2}
	for name, body := range map[string]map[string]any{
		"no sections": req(openai.GrammarSections{}, "gpt-5.1"),
		"bad model":   req(all, "gpt-3.5-turbo-0125"),
		"weak model":  req(all, "gpt-5-nano"), // only strong models design questions
		"too many":    req(openai.GrammarSections{MultipleChoice: 31}, "gpt-5.1"),
		"bad vocab level": func() map[string]any {
			b := req(all, "gpt-5.1")
			b["vocabLevel"] = "D1"
			return b
		}(),
		"too many words": func() map[string]any {
			b := req(all, "gpt-5.1")
			words := make([]string, maxGrammarWords+1)
			for i := range words {
				words[i] = "Wort" + itoa(int64(i))
			}
			b["vocabulary"] = words
			return b
		}(),
	} {
		if code := c.json("POST", "/api/grammar", body, nil); code != 400 {
			t.Errorf("%s: %d", name, code)
		}
	}

	var g store.GrammarSet
	withWords := req(all, "gpt-5.1")
	withWords["vocabulary"] = []string{" Kaffee ", "Reise", "Kaffee", ""} // trimmed, deduplicated
	if code := c.json("POST", "/api/grammar", withWords, &g); code != 201 || g.Status != "generating" {
		t.Fatalf("create: %d %+v", code, g)
	}
	path := "/api/grammar/" + itoa(g.ID)
	for deadline := time.Now().Add(10 * time.Second); g.Status == "generating" && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		c.json("GET", path, nil, &g)
	}
	if g.Status != "ready" {
		t.Fatalf("status %q: %s", g.Status, g.Error)
	}
	var content openai.GrammarContent
	json.Unmarshal(g.Content, &content)
	switch {
	case content.Title != "Konjunktiv II" || content.Overview == "":
		t.Errorf("core: %+v", content)
	case len(content.MultipleChoice) != 1: // the broken question is dropped
		t.Errorf("multiple choice: %+v", content.MultipleChoice)
	case content.MultipleChoice[0].Options[content.MultipleChoice[0].Answer] != "hätte": // options are shuffled, the answer follows
		t.Errorf("answer lost in shuffle: %+v", content.MultipleChoice[0])
	case content.Listening != nil && len(content.Listening.Questions) > 0 && content.Listening.Questions[0].Options[content.Listening.Questions[0].Answer] != "Kaffee":
		t.Errorf("listening answer lost in shuffle: %+v", content.Listening.Questions[0])
	case len(content.Rearrange) != 1 || strings.Join(content.Rearrange[0].Fragments, " ") == "Ich würde gern kommen":
		t.Errorf("rearrange not scrambled: %+v", content.Rearrange)
	case content.Reading == nil || len(content.Reading.Questions) != 1:
		t.Errorf("reading: %+v", content.Reading)
	case content.Listening == nil || len(content.Listening.Questions) != 2 || content.Listening.Questions[1].Answer != -1 || len(content.Listening.Questions[1].Options) != 0:
		t.Errorf("listening: %+v", content.Listening)
	case len(content.Writing) != 2 || content.Errors != nil:
		t.Errorf("writing/errors: %+v %v", content.Writing, content.Errors)
	case g.AudioURL != "": // no Azure key: the browser reads the script
		t.Errorf("audio without azure: %q", g.AudioURL)
	case math.Abs(g.CostUSD-5*0.00625) > 1e-9: // 5 calls of 1000 in + 500 out tokens on gpt-5.1
		t.Errorf("cost: %v", g.CostUSD)
	}

	if code := intruder.json("GET", path, nil, nil); code != 404 {
		t.Errorf("other user reads set: %d", code)
	}
	if code := c.json("PUT", path+"/answers", map[string]any{"answers": map[string]any{"mc": map[string]int{"0": 1}}}, nil); code != 204 {
		t.Errorf("save answers: %d", code)
	}
	if code := c.json("POST", path+"/writing", map[string]any{"answers": []string{"x"}}, nil); code != 400 {
		t.Errorf("wrong answer count: %d", code)
	}
	var graded struct {
		WritingFeedback struct {
			Answers []string
			Items   []openai.WritingFeedback
		}
		CostUSD float64
	}
	if code := c.json("POST", path+"/writing", map[string]any{"answers": []string{" Ich hätte gern einen Kaffee. ", "Wenn ich reich bin"}}, &graded); code != 200 {
		t.Fatalf("grade writing: %d", code)
	}
	if fb := graded.WritingFeedback; len(fb.Items) != 2 || fb.Items[1].Score != 10 || fb.Answers[0] != "Ich hätte gern einen Kaffee." {
		t.Errorf("feedback: %+v", fb)
	}

	var list []store.GrammarSet
	c.json("GET", "/api/grammar", nil, &list)
	if len(list) != 1 || list[0].Title != "Konjunktiv II" || !list[0].Started || math.Abs(list[0].CostUSD-6*0.00625) > 1e-9 {
		t.Errorf("list: %+v", list)
	}
	// A part written again: new questions, its answers start afresh, the
	// others are kept; the set's own words are used again.
	c.json("PUT", path+"/answers", map[string]any{"answers": map[string]any{
		"multipleChoice": map[string]int{"0": 1}, "rearrange": map[string]string{"0": "Ich würde"},
		"checked": map[string]bool{"multipleChoice": true, "rearrange": true}, "progress": map[string]any{"rearrange": map[string]int{"answered": 1}}}}, nil)
	for name, body := range map[string]map[string]any{
		"bad section": {"section": "speaking", "count": 3},
		"no count":    {"section": "rearrange", "count": 0},
		"too many":    {"section": "writing", "count": 21},
	} {
		if code := c.json("POST", path+"/sections", body, nil); code != 400 {
			t.Errorf("section %s: %d", name, code)
		}
	}
	if code := intruder.json("POST", path+"/sections", map[string]any{"section": "rearrange", "count": 2}, nil); code != 404 {
		t.Errorf("other user regenerates: %d", code)
	}
	regen := func(section string) {
		t.Helper()
		if code := c.json("POST", path+"/sections", map[string]any{"section": section, "count": 2}, &g); code != 202 || g.Pending != section {
			t.Fatalf("regenerate %s: %d %+v", section, code, g)
		}
		for deadline := time.Now().Add(10 * time.Second); g.Pending != "" && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			g = store.GrammarSet{} // omitted fields must not keep their old values
			c.json("GET", path, nil, &g)
		}
		if g.Pending != "" {
			t.Fatalf("%s still pending", section)
		}
	}
	regen("rearrange")
	var answers struct {
		MultipleChoice map[string]int
		Rearrange      map[string]string
		Checked        map[string]bool
		Progress       map[string]any
	}
	json.Unmarshal(g.Answers, &answers)
	if len(answers.Rearrange) != 0 || answers.Checked["rearrange"] || !answers.Checked["multipleChoice"] || answers.MultipleChoice["0"] != 1 || answers.Progress["rearrange"] != nil {
		t.Errorf("answers after regenerating: %s", g.Answers)
	}
	if len(g.WritingFeedback) == 0 {
		t.Error("writing grading lost when another part was regenerated")
	}
	regen("writing")
	if len(g.WritingFeedback) != 0 && string(g.WritingFeedback) != "null" {
		t.Errorf("old writing grading kept: %s", g.WritingFeedback)
	}
	if math.Abs(g.CostUSD-8*0.00625) > 1e-9 {
		t.Errorf("cost after two parts: %v", g.CostUSD)
	}

	if code := c.json("DELETE", path, nil, nil); code != 204 {
		t.Errorf("delete: %d", code)
	}
}

func TestListeningSSML(t *testing.T) {
	got := speech.SSML("de-DE", []speech.Line{{Gender: "female", Text: "Fisch & Chips <bitte>"}, {Gender: "male", Voice: 1, Text: "Gern."}})
	for _, want := range []string{`xml:lang="de-DE"`, `de-DE-KatjaNeural`, `de-DE-KillianNeural`, `Fisch &amp; Chips &lt;bitte&gt;`} {
		if !strings.Contains(got, want) {
			t.Errorf("SSML misses %q: %s", want, got)
		}
	}
}
