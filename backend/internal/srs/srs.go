// Package srs schedules flashcard reviews with a simplified SM-2 algorithm:
// each card has an ease factor and an interval; answering "good" multiplies
// the interval by the ease, "again" sends the card back to the start.
package srs

import (
	"math"
	"time"
)

type Grade int

const (
	Again Grade = 1 // forgot
	Hard  Grade = 2 // remembered with effort
	Good  Grade = 3 // remembered
	Easy  Grade = 4 // remembered instantly
)

const (
	minEase     = 1.3
	maxInterval = 365.0 // days
	relearn     = 10 * time.Minute
)

// Card is the scheduling state of one flashcard.
type Card struct {
	Ease     float64 // starts at 2.5
	Interval float64 // days; 0 = not yet learned
	Reps     int     // successful reviews in a row
}

// Next returns the card state after answering with g, and when it is due again.
func Next(c Card, g Grade, now time.Time) (Card, time.Time) {
	if c.Ease == 0 {
		c.Ease = 2.5
	}
	switch g {
	case Again:
		c.Reps, c.Interval = 0, 0
		c.Ease = math.Max(minEase, c.Ease-0.2)
		return c, now.Add(relearn)
	case Hard:
		if c.Reps == 0 {
			c.Interval = 1
		} else {
			c.Interval = math.Max(c.Interval+1, c.Interval*1.2)
		}
		c.Ease = math.Max(minEase, c.Ease-0.15)
	case Good:
		switch c.Reps {
		case 0:
			c.Interval = 1
		case 1:
			c.Interval = math.Max(c.Interval, 3)
		default:
			c.Interval = c.Interval * c.Ease
		}
	case Easy:
		switch c.Reps {
		case 0:
			c.Interval = 4
		default:
			c.Interval = math.Max(c.Interval+1, c.Interval*c.Ease*1.3)
		}
		c.Ease += 0.15
	}
	c.Interval = math.Min(maxInterval, math.Round(c.Interval*10)/10)
	c.Reps++
	return c, now.Add(time.Duration(c.Interval * 24 * float64(time.Hour)))
}

// Preview gives, for each grade, how long until the card would be due again.
func Preview(c Card) map[Grade]time.Duration {
	now := time.Unix(0, 0)
	out := make(map[Grade]time.Duration, 4)
	for _, g := range []Grade{Again, Hard, Good, Easy} {
		_, due := Next(c, g, now)
		out[g] = due.Sub(now)
	}
	return out
}

// State is a coarse learning stage, used for statistics.
func State(c Card, reviews int) string {
	switch {
	case reviews == 0:
		return "new"
	case c.Interval < 1:
		return "learning"
	case c.Interval < 21:
		return "young"
	default:
		return "mature"
	}
}
