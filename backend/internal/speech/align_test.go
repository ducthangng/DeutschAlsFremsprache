package speech

import "testing"

func TestAlign(t *testing.T) {
	words := []RecognizedWord{
		{Word: "guten", AccuracyScore: 95, ErrorType: "None"},
		{Word: "tag", AccuracyScore: 40, ErrorType: "Mispronunciation"},
		{Word: "ähm", AccuracyScore: 0, ErrorType: "Insertion"},
		{Word: "e", AccuracyScore: 90, ErrorType: "None"},
		{Word: "mail", AccuracyScore: 55, ErrorType: "None"},
		{Word: "bitte", AccuracyScore: 0, ErrorType: "Omission"},
	}
	got := Align("Guten Tag! — E-Mail, bitte.", words, 60)
	want := []string{"ok", "mispronounced", "skip", "mispronounced", "omitted"}
	if len(got) != len(want) {
		t.Fatalf("len %d: %#v", len(got), got)
	}
	for i, s := range want {
		if got[i].Status != s {
			t.Errorf("token %d %q: got %s want %s", i, got[i].Text, got[i].Status, s)
		}
	}
	if got[3].Score != 55 {
		t.Errorf("merged score = %v", got[3].Score)
	}
}

func TestAlignMissingTail(t *testing.T) {
	got := Align("Hello world", []RecognizedWord{{Word: "hello", AccuracyScore: 90, ErrorType: "None"}}, 60)
	if got[1].Status != "omitted" {
		t.Fatalf("got %#v", got)
	}
}

func TestParseAssessmentNested(t *testing.T) {
	raw := []byte(`{"RecognitionStatus":"Success","DisplayText":"Hallo.","NBest":[{"Display":"Hallo.",
		"PronunciationAssessment":{"AccuracyScore":80,"FluencyScore":90,"CompletenessScore":100,"PronScore":85},
		"Words":[{"Word":"hallo","PronunciationAssessment":{"AccuracyScore":80,"ErrorType":"None"}}]}]}`)
	a, err := parseAssessment(raw)
	if err != nil || a.PronScore != 85 || len(a.Words) != 1 || a.Words[0].AccuracyScore != 80 {
		t.Fatalf("got %#v %v", a, err)
	}
}

func TestParseAssessmentFlat(t *testing.T) {
	raw := []byte(`{"RecognitionStatus":"Success","NBest":[{"AccuracyScore":70,"FluencyScore":60,"CompletenessScore":100,"PronScore":72,
		"Words":[{"Word":"hi","AccuracyScore":70,"ErrorType":"None"}]}]}`)
	a, err := parseAssessment(raw)
	if err != nil || a.PronScore != 72 || a.Words[0].ErrorType != "None" {
		t.Fatalf("got %#v %v", a, err)
	}
}

func TestParseAssessmentNoMatch(t *testing.T) {
	a, err := parseAssessment([]byte(`{"RecognitionStatus":"NoMatch"}`))
	if err != nil || a.PronScore != 0 || len(a.Words) != 0 {
		t.Fatalf("got %#v %v", a, err)
	}
}
