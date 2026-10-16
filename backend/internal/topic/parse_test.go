package topic

import (
	"reflect"
	"testing"
)

func TestParseDialogue(t *testing.T) {
	got := Parse(KindDialogue, "Anna: Wo ist der Bahnhof? | Nhà ga ở đâu?\n\n# comment\nBen: Geradeaus.\nEs ist 10:30 Uhr.\r\n")
	want := []Line{
		{Speaker: "Anna", Text: "Wo ist der Bahnhof?", Note: "Nhà ga ở đâu?"},
		{Speaker: "Ben", Text: "Geradeaus."},
		{Text: "Es ist 10:30 Uhr."},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v", got)
	}
}

func TestParseVocabularyIgnoresColon(t *testing.T) {
	got := Parse(KindVocabulary, "Uhrzeit: 10 Uhr | giờ")
	if len(got) != 1 || got[0].Speaker != "" || got[0].Text != "Uhrzeit: 10 Uhr" || got[0].Note != "giờ" {
		t.Fatalf("got %#v", got)
	}
}

func TestFormatRoundTrip(t *testing.T) {
	src := "Anna: Hallo! | Xin chào\nBen: Tschüss.\n"
	if got := Format(Parse(KindDialogue, src)); got != src {
		t.Fatalf("got %q", got)
	}
}
