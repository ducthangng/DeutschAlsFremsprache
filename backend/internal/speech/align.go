package speech

import (
	"hash/fnv"
	"strings"
	"unicode"
)

// Token is one whitespace-separated piece of the reference text with its
// verdict, so the UI can render the sentence exactly as written.
type Token struct {
	Text   string  `json:"text"`
	Status string  `json:"status"` // ok | mispronounced | omitted | skip (punctuation only)
	Score  float64 `json:"score"`
}

func normalize(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Align maps Azure's recognized words back onto the reference text tokens.
// Azure reports words lower-cased without punctuation and may split a token
// (e.g. "E-Mail" -> "e", "mail"), so split words are merged and the worst
// verdict wins.
func Align(reference string, words []RecognizedWord, wordThreshold float64) []Token {
	var ws []RecognizedWord
	for _, w := range words {
		if w.ErrorType != "Insertion" {
			ws = append(ws, w)
		}
	}
	fields := strings.Fields(reference)
	out := make([]Token, 0, len(fields))
	j := 0
	for _, f := range fields {
		norm := normalize(f)
		if norm == "" {
			out = append(out, Token{Text: f, Status: "skip"})
			continue
		}
		if j >= len(ws) {
			out = append(out, Token{Text: f, Status: "omitted"})
			continue
		}
		// Re-sync if the next word matches exactly a little further ahead
		// (Azure occasionally emits extra fragments).
		if normalize(ws[j].Word) != norm {
			for k := j + 1; k < len(ws) && k <= j+2; k++ {
				if normalize(ws[k].Word) == norm {
					j = k
					break
				}
			}
		}
		group := []RecognizedWord{ws[j]}
		acc := normalize(ws[j].Word)
		j++
		for j < len(ws) && acc != norm && strings.HasPrefix(norm, acc+normalize(ws[j].Word)) {
			acc += normalize(ws[j].Word)
			group = append(group, ws[j])
			j++
		}
		out = append(out, verdict(f, group, wordThreshold))
	}
	return out
}

func verdict(text string, group []RecognizedWord, threshold float64) Token {
	t := Token{Text: text, Status: "ok", Score: 100}
	for _, w := range group {
		if w.AccuracyScore < t.Score {
			t.Score = w.AccuracyScore
		}
		switch {
		case w.ErrorType == "Omission":
			t.Status, t.Score = "omitted", 0
			return t
		case w.ErrorType == "Mispronunciation" || w.AccuracyScore < threshold:
			t.Status = "mispronounced"
		}
	}
	return t
}

// MockAssess produces plausible fake scores so the app can be exercised
// without Azure credentials. Results are deterministic per (text, audio size).
func MockAssess(reference string, audioLen int) *Assessment {
	h := fnv.New32a()
	h.Write([]byte(reference))
	seed := h.Sum32() ^ uint32(audioLen)
	next := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	a := &Assessment{Recognized: reference}
	var sum float64
	n := 0
	for _, f := range strings.Fields(reference) {
		if normalize(f) == "" {
			continue
		}
		score := 55 + next()*45
		et := "None"
		if score < 62 {
			et = "Mispronunciation"
		}
		a.Words = append(a.Words, RecognizedWord{Word: normalize(f), AccuracyScore: float64(int(score)), ErrorType: et})
		sum += score
		n++
	}
	if n > 0 {
		avg := float64(int(sum / float64(n)))
		a.Scores = Scores{PronScore: avg, AccuracyScore: avg, FluencyScore: float64(int(70 + next()*30)), CompletenessScore: 100}
	}
	return a
}
