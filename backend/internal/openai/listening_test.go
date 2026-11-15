package openai

import (
	"strings"
	"testing"
)

func TestOrderListening(t *testing.T) {
	segs := []Segment{
		{Speaker: "Lena", Text: "Hallo Jonas! Ich war gestern im Kino."},
		{Speaker: "Jonas", Text: "Ich bin am Wochenende nach Berlin gefahren."},
		{Speaker: "Lena", Text: "Wir haben dort eine Pizza gegessen."},
	}
	choice := func(quote, q, correct string, wrong ...string) rawListeningQuestion {
		return rawListeningQuestion{Kind: "choice", Quote: quote, Question: q, Correct: correct, Distractors: wrong}
	}
	blank := func(q string, acc ...string) rawListeningQuestion {
		return rawListeningQuestion{Kind: "blank", Question: q, Accepted: acc}
	}
	raw := []rawListeningQuestion{
		choice("Wir haben dort eine Pizza gegessen.", "Was haben sie gegessen?", "Pizza", "Pasta", "Suppe", "Salat"),
		blank("Ich bin am Wochenende nach Berlin ___.", "gefahren"),
		choice("ich war gestern im kino", "Wo war Lena gestern?", "Im Kino", "Im Park", "Zu Hause", "Im Café"),
		blank("Ich ___ gestern im Kino.", "war"),                         // same sentence as an earlier question
		blank("Wir haben dort eine ___ gegessen.", "Suppe"),              // not what is said
		choice("Er fliegt nach Rom.", "Wohin fliegt er?", "Rom", "Paris"), // quote not in the script
		choice("Ich bin am Wochenende", "Wann?", "Am Wochenende", "Am Wochenende"),
	}
	qs := orderListening(segs, raw)
	var got []string
	for _, q := range qs {
		got = append(got, q.Question)
	}
	want := "Wo war Lena gestern?|Ich bin am Wochenende nach Berlin ___.|Was haben sie gegessen?"
	if strings.Join(got, "|") != want {
		t.Fatalf("order: %q", got)
	}
	if q := qs[0]; len(q.Options) != 4 || q.Options[q.Answer] != "Im Kino" {
		t.Errorf("choice answer lost: %+v", q)
	}
	if q := qs[1]; q.Answer != -1 || q.Accepted[0] != "gefahren" {
		t.Errorf("blank: %+v", q)
	}

	// The options really are shuffled: the answer is not always first.
	moved := false
	for range 50 {
		if q := orderListening(segs, raw[:1])[0]; q.Answer != 0 {
			moved = true
			break
		}
	}
	if !moved {
		t.Error("options never shuffled")
	}

	// Keeping fewer questions keeps them in recording order.
	if s := spread(qs, 2); len(s) != 2 || s[0].Question != qs[0].Question || s[1].Question == s[0].Question {
		t.Errorf("spread: %+v", s)
	}
}
