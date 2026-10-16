package srs

import (
	"testing"
	"time"
)

func TestSchedule(t *testing.T) {
	now := time.Now()
	c := Card{Ease: 2.5}
	c, due := Next(c, Good, now)
	if c.Interval != 1 || c.Reps != 1 || due.Sub(now) != 24*time.Hour {
		t.Fatalf("first good: %+v", c)
	}
	c, _ = Next(c, Good, now)
	if c.Interval != 3 {
		t.Fatalf("second good: %+v", c)
	}
	c, _ = Next(c, Good, now)
	if c.Interval != 7.5 {
		t.Fatalf("third good: %+v", c)
	}
	c, due = Next(c, Again, now)
	if c.Reps != 0 || c.Interval != 0 || c.Ease != 2.3 || due.Sub(now) != relearn {
		t.Fatalf("again: %+v", c)
	}
	if c, _ = Next(Card{Ease: 1.3}, Hard, now); c.Ease != minEase {
		t.Fatalf("ease floor: %+v", c)
	}
	if c, _ = Next(Card{Ease: 2.5, Interval: 300, Reps: 9}, Easy, now); c.Interval != maxInterval {
		t.Fatalf("cap: %+v", c)
	}
}

func TestPreviewAndState(t *testing.T) {
	p := Preview(Card{Ease: 2.5})
	if p[Again] != relearn || p[Good] != 24*time.Hour || p[Easy] != 96*time.Hour {
		t.Fatalf("preview: %v", p)
	}
	if State(Card{}, 0) != "new" || State(Card{Interval: 30}, 5) != "mature" || State(Card{Interval: 3}, 2) != "young" {
		t.Fatal("state")
	}
}
