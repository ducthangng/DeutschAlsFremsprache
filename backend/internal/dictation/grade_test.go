package dictation

import (
	"reflect"
	"testing"
)

func statuses(r Result) []string {
	var out []string
	for _, t := range r.Tokens {
		out = append(out, t.Status)
	}
	return out
}

func TestGradePerfectIgnoresPunctuation(t *testing.T) {
	r := Grade("Wo ist Gleis drei?", "wo ist Gleis drei")
	if r.Score != 93.8 || !r.Passed || !reflect.DeepEqual(statuses(r), []string{Case, OK, OK, OK}) {
		t.Fatalf("got %+v", r)
	}
	if r := Grade("Wo ist Gleis drei?", "Wo ist Gleis drei"); r.Score != 100 {
		t.Fatalf("exact: %+v", r)
	}
}

func TestGradeNearMisses(t *testing.T) {
	r := Grade("Die Verspätung ist groß.", "Die Verspaetung ist gross")
	if !reflect.DeepEqual(statuses(r), []string{OK, Spelling, OK, Spelling}) {
		t.Fatalf("umlauts: %+v", r)
	}
	r = Grade("Entschuldigung bitte", "Entschuldiung bitte")
	if !reflect.DeepEqual(statuses(r), []string{Typo, OK}) || r.Score != 75 {
		t.Fatalf("typo: %+v", r)
	}
}

func TestGradeAlignsMissingAndExtraWords(t *testing.T) {
	r := Grade("Ich möchte eine Fahrkarte nach Berlin", "Ich möchte Fahrkarte nach nach Berlin")
	want := []string{OK, OK, Missing, OK, OK, Extra, OK}
	if !reflect.DeepEqual(statuses(r), want) {
		t.Fatalf("got %v", statuses(r))
	}
	if r.Tokens[2].Expected != "eine" || r.Passed {
		t.Fatalf("missing word: %+v", r)
	}
}

func TestGradeWrongAndEmpty(t *testing.T) {
	r := Grade("Guten Morgen", "Guten Abend")
	if !reflect.DeepEqual(statuses(r), []string{OK, Wrong}) || r.Tokens[1].Expected != "Morgen" || r.Score != 50 {
		t.Fatalf("wrong: %+v", r)
	}
	if r := Grade("Hallo", ""); r.Score != 0 || r.Tokens[0].Status != Missing {
		t.Fatalf("empty: %+v", r)
	}
}
