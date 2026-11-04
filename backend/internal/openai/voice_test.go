package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The model's answer is checked: every voice matches the speaker's gender,
// titles (Herr/Frau) win over the model, and no two speakers share a voice.
func TestCastVoicesGender(t *testing.T) {
	answer := map[string]any{"tone": "cheerful", "toneVi": "vui vẻ", "speakers": []map[string]string{
		{"speaker": "Anna", "gender": "female", "persona": "a cheerful young woman", "voice": "onyx"}, // male voice for a woman
		{"speaker": "Herr Weber", "gender": "female", "persona": "a friendly lady", "voice": "coral"}, // model got the man wrong
		{"speaker": "Lena:", "gender": "female", "persona": "a happy girl", "voice": "nova"},          // name with a stray colon
		{"speaker": "Max", "gender": "male", "persona": "a young man", "voice": "made-up"},            // unknown voice
		{"speaker": "A", "gender": "unknown", "persona": "an interviewer", "voice": "nova"},           // voice already taken
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		content, _ := json.Marshal(answer)
		json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": string(content)}, "finish_reason": "stop"}},
			"usage":   map[string]int{"prompt_tokens": 10, "completion_tokens": 10},
		})
	}))
	defer srv.Close()
	c := New(Config{APIKey: "k", BaseURL: srv.URL, ChatModel: "m"})
	vc, _, err := c.CastVoices(context.Background(), "de-DE", "Party", "", []string{"Anna", "Herr Weber", "Lena", "Max", "A"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ gender, voice string }{{"female", "coral"}, {"male", "ash"}, {"female", "nova"}, {"male", "verse"}, {"unknown", "shimmer"}}
	used := map[string]bool{}
	for i, m := range vc.Speakers {
		if m.Gender != want[i].gender || m.Voice != want[i].voice || used[m.Voice] {
			t.Errorf("%s: %+v, want %+v", m.Speaker, m, want[i])
		}
		used[m.Voice] = true
	}
	if vc.Speakers[1].Character != "" {
		t.Errorf("persona of the wrong gender kept: %q", vc.Speakers[1].Character)
	}
	if !vc.Current() {
		t.Error("new cast not current")
	}
	// Without a cast, a titled name still gets a voice of its gender.
	if v, _ := (*VoiceCast)(nil).For("Herr Weber", 0); voiceGender(v) != "male" {
		t.Errorf("default voice for Herr Weber: %s", v)
	}
	if v, _ := (*VoiceCast)(nil).For("", -1); v == "" {
		t.Error("no narrator voice")
	}
}
