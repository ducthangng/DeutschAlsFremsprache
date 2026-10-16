package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

// fakeChat answers by schema name: scenario, turn evaluation, summary, images.
func fakeChat(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		reply := func(content any) {
			b, _ := json.Marshal(content)
			json.NewEncoder(w).Encode(map[string]any{
				"choices": []any{map[string]any{"message": map[string]any{"content": string(b)}, "finish_reason": "stop"}},
				"usage":   map[string]int{"prompt_tokens": 1000, "completion_tokens": 1000},
			})
		}
		switch {
		case r.URL.Path == "/v1/images/generations":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(pngBytes())}}})
		case strings.Contains(string(body), `"name":"scenario"`):
			if !strings.Contains(string(body), "Fahrkarte") { // pocket words feed the scenario
				t.Errorf("scenario prompt lacks learner vocabulary: %s", body)
			}
			reply(map[string]any{"title": "Mất vé tàu", "setting": "Ga Hamburg", "partner": "Herr Ott, Schaffner", "userRole": "Hành khách",
				"goal": "Giải thích và mua vé mới", "opening": "Guten Tag, Ihre Fahrkarte bitte!", "openingVi": "Xin chào, vé của anh?",
				"twist": "SECRET-TWIST", "usefulWords": []any{map[string]string{"term": "verlieren", "meaning": "làm mất"}}})
		case strings.Contains(string(body), `"name":"turn_evaluation"`):
			reply(map[string]any{"logicScore": 80, "understood": true, "feedback": "Tốt!", "corrected": "Ich habe meine Fahrkarte verloren.",
				"grammarNote": "", "reply": "Kein Problem.", "replyVi": "Không sao.", "end": false})
		case strings.Contains(string(body), `"name":"simulation_summary"`):
			reply(map[string]any{"overall": 77, "goalReached": true, "cefr": "A2", "strengths": []string{"rõ ràng"}, "improvements": []string{"chia động từ"},
				"usefulPhrases": []any{map[string]string{"phrase": "Ich habe … verloren", "meaning": "tôi làm mất …"}}, "verdict": "Giỏi lắm!"})
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestSimulationTypedFlowAndVocabImage(t *testing.T) {
	oa := fakeChat(t)
	defer oa.Close()
	server, err := New(context.Background(), config.Config{DataDir: t.TempDir(), JWTSecret: "x", OpenAIKey: "k", OpenAIBaseURL: oa.URL + "/v1",
		OpenAIChatModel: "gpt-test", OpenAIChatUSDPerMIn: 1, OpenAIChatUSDPerMOut: 1, OpenAIImageModel: "gpt-image-1", OpenAIImageUSD: 0.011}, openTestStore(t))
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	c := other(t, srv.URL)

	// A pocket word, illustrated by AI.
	var v store.VocabEntry
	c.json("POST", "/api/vocab", vocabInput{Language: "de-DE", Term: "die Fahrkarte", Meaning: "vé"}, &v)
	var gen struct {
		Entry   store.VocabEntry
		CostUSD float64
	}
	if code := c.json("POST", "/api/vocab/"+itoa(v.ID)+"/image", nil, &gen); code != 200 || gen.Entry.ImageURL == "" || gen.CostUSD != 0.011 {
		t.Fatalf("vocab image: %d %+v", code, gen)
	}

	// Start: scenario from history, opening line, twist hidden.
	var sim simulationDetail
	if code := c.json("POST", "/api/simulations", map[string]string{"language": "de-DE", "level": "A2"}, &sim); code != 201 {
		t.Fatalf("create simulation: %d", code)
	}
	if strings.Contains(string(sim.Scenario), "SECRET") || len(sim.Turns) != 1 || sim.Turns[0].Speaker != "ai" || sim.Costs.LLMUSD != 0.002 {
		t.Fatalf("simulation start: %s %+v %+v", sim.Scenario, sim.Turns, sim.Costs)
	}
	path := "/api/simulations/" + itoa(sim.ID)

	// Ten typed rounds, then the simulation closes itself with a summary.
	for i := 1; i <= 10; i++ {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		mw.WriteField("text", "Ich habe meine Fahrkarte verlieren")
		mw.Close()
		sim = simulationDetail{}
		if code := c.do("POST", path+"/turns", &body, mw.FormDataContentType(), &sim); code != 200 {
			t.Fatalf("round %d: %d", i, code)
		}
	}
	if sim.Status != "finished" || len(sim.Turns) != 21 {
		t.Fatalf("after 10 rounds: %s, %d turns", sim.Status, len(sim.Turns))
	}
	u := sim.Turns[1]
	var ev userEvaluation
	json.Unmarshal(u.Evaluation, &ev)
	if u.Speaker != "user" || !u.Typed || *u.LogicScore != 80 || ev.Corrected == "" || u.CostUSD != 0.002 {
		t.Fatalf("user turn: %+v %+v", u, ev)
	}
	var summary map[string]any
	json.Unmarshal(sim.Summary, &summary)
	if summary["overall"] != 77.0 || summary["rounds"] != 10.0 || summary["avgLogic"] != 80.0 {
		t.Fatalf("summary: %v", summary)
	}
	// scenario + 10 evaluations + summary, each 2000 tokens at $1/M
	if sim.Costs.LLMUSD < 0.0239 || sim.Costs.LLMUSD > 0.0241 || sim.Costs.Tokens != 24000 {
		t.Fatalf("costs: %+v", sim.Costs)
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("text", "noch etwas")
	mw.Close()
	if code := c.do("POST", path+"/turns", &body, mw.FormDataContentType(), nil); code != 409 {
		t.Fatalf("turn after finish: %d", code)
	}
	var list []store.Simulation
	c.json("GET", "/api/simulations", nil, &list)
	if len(list) != 1 || list[0].UserTurns != 10 || list[0].AvgLogic != 80 || list[0].CostUSD < 0.0239 {
		t.Fatalf("list: %+v", list)
	}
	if other(t, srv.URL).json("GET", path, nil, nil) != 404 {
		t.Fatal("simulation visible to another user")
	}
}

func TestVocabStats(t *testing.T) {
	now := time.Date(2026, 10, 16, 3, 0, 0, 0, time.UTC) // 10:00 in Vietnam (UTC+7)
	day := func(d int) time.Time { return time.Date(2026, 10, 16+d, 0, 0, 0, 0, time.UTC) }
	cards := []*store.VocabEntry{
		{State: "new", DueAt: now.Add(-time.Hour)},
		{State: "young", DueAt: now.Add(30 * time.Hour)},   // tomorrow (local)
		{State: "mature", DueAt: now.Add(400 * time.Hour)}, // beyond the forecast
	}
	days := []store.ReviewDay{
		{Day: day(-10), Reviews: 5, Remembered: 5},
		{Day: day(-2), Reviews: 4, Remembered: 2},
		{Day: day(-1), Reviews: 6, Remembered: 6},
		{Day: day(0), Reviews: 10, Remembered: 8, DurationMs: 120000},
	}
	st := computeStats(cards, days, now, 420)
	if st.Streak != 3 || st.BestStreak != 3 || st.ReviewedToday != 10 || st.MinutesToday != 2 || st.DueNow != 1 {
		t.Fatalf("stats: %+v", st)
	}
	if *st.Retention30 != 84 || len(st.Days) != 30 || st.Days[29].Reviews != 10 || st.Forecast[0].Reviews != 1 || st.Forecast[1].Reviews != 1 {
		t.Fatalf("retention/days/forecast: %v %+v %+v", *st.Retention30, st.Days[29], st.Forecast)
	}
	if st := computeStats(nil, days[:3], now, 420); st.Streak != 2 { // nothing today yet: streak still alive from yesterday
		t.Fatalf("streak without today: %d", st.Streak)
	}
}
