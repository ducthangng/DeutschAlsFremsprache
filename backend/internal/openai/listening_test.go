package openai

import (
	"encoding/json"
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
		blank("Ich ___ gestern im Kino.", "war"),                          // same sentence as an earlier question
		blank("Wir haben dort eine ___ gegessen.", "Suppe"),               // not what is said
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

// The model writes JSON in schema order: questions before their answers, the
// script before the questions about it.
func TestSchemaOrder(t *testing.T) {
	for name, c := range map[string]struct {
		schema map[string]any
		order  []string
	}{
		"choice":    {choiceSchema, []string{`"question"`, `"correct"`, `"distractors"`, `"explanation"`}},
		"reading":   {readingSchema, []string{`"passage"`, `"questions"`}},
		"listening": {listeningSchema, []string{`"segments"`, `"questions"`, `"quote"`, `"question"`, `"correct"`, `"accepted"`, `"explanation"`}},
		"writing":   {writingSchema, []string{`"english"`, `"german"`, `"alternatives"`}},
	} {
		b, err := json.Marshal(c.schema)
		if err != nil {
			t.Fatal(err)
		}
		last := -1
		for _, k := range c.order {
			i := strings.Index(string(b), k+`:{`)
			if i <= last {
				t.Errorf("%s: %s out of order in %s", name, k, b)
			}
			last = i
		}
	}
}

func TestMarkAddress(t *testing.T) {
	for _, c := range []struct {
		english, address, want string
		ok                     bool
	}{
		{"Could you help me?", "Sie", "Could you (Sie, formal) help me?", true},
		{"Have you (du) seen my keys?", "du", "Have you (du) seen my keys?", true}, // already marked
		{"Is this your car?", "ihr", "Is this your (ihr) car?", true},
		{"You never know.", "man", "You (man) never know.", true},
		{"I would like a coffee.", "none", "I would like a coffee.", true},
		{"Young people travel a lot.", "none", "Young people travel a lot.", true}, // "Young" is not "you"
		{"Can you come?", "none", "", false},                                       // "you" without a form: dropped
	} {
		got, ok := markAddress(WritingTask{English: c.english, Address: c.address})
		if ok != c.ok || (ok && got.English != c.want) {
			t.Errorf("%q/%s: %q %v", c.english, c.address, got.English, ok)
		}
	}
}
