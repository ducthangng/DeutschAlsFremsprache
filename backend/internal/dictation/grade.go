// Package dictation grades "Listen -> Write" answers: the learner types what
// they heard and each word is compared with the reference sentence.
//
// Words are aligned with an edit-distance DP, so a missing or extra word does
// not shift every following word into "wrong". Near misses earn partial credit.
package dictation

import (
	"strings"
	"unicode"
)

// PassScore is the score (0..100) needed for a line to count as passed.
const PassScore = 85

// Status of one word in the graded answer.
const (
	OK       = "ok"       // exactly right (punctuation ignored)
	Case     = "case"     // only capitalization differs (matters in German nouns)
	Spelling = "spelling" // umlaut/ß written as ae/oe/ue/ss
	Typo     = "typo"     // one or two letters off
	Wrong    = "wrong"    // a different word
	Missing  = "missing"  // in the sentence, not in the answer
	Extra    = "extra"    // in the answer, not in the sentence
)

var credit = map[string]float64{OK: 1, Case: 0.75, Spelling: 0.75, Typo: 0.5, Wrong: 0}

// subCost is the alignment cost of pairing two words. A wrong word costs a bit
// more than 1 so that, on a tie, "one word missing + one extra" is preferred
// over shifting several words into "wrong".
func subCost(st string) float64 {
	if st == Wrong {
		return 1.1
	}
	return 1 - credit[st]
}

type Token struct {
	Text     string `json:"text"`     // what the learner wrote ("" when missing)
	Expected string `json:"expected"` // the reference word ("" when extra)
	Status   string `json:"status"`
}

type Result struct {
	Score  float64 `json:"score"`
	Passed bool    `json:"passed"`
	Tokens []Token `json:"tokens"`
}

func strip(w string) string {
	return strings.TrimFunc(w, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

var fold = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss")

// compare classifies how close an answer word is to a reference word.
func compare(ref, ans string) string {
	r, a := strip(ref), strip(ans)
	switch {
	case r == a:
		return OK
	case strings.EqualFold(r, a):
		return Case
	}
	rl, al := strings.ToLower(r), strings.ToLower(a)
	if fold.Replace(rl) == fold.Replace(al) {
		return Spelling
	}
	d, n := levenshtein(rl, al), len([]rune(rl))
	if (n >= 4 && d <= 1) || (n >= 8 && d <= 2) {
		return Typo
	}
	return Wrong
}

// Grade compares the learner's answer with the reference sentence.
func Grade(reference, answer string) Result {
	var ref, ans []string
	for _, w := range strings.Fields(reference) {
		if strip(w) != "" { // ignore stand-alone punctuation such as "—"
			ref = append(ref, w)
		}
	}
	for _, w := range strings.Fields(answer) {
		if strip(w) != "" {
			ans = append(ans, w)
		}
	}
	n, m := len(ref), len(ans)

	// cost[i][j]: cheapest alignment of ref[i:] with ans[j:].
	cost := make([][]float64, n+1)
	for i := range cost {
		cost[i] = make([]float64, m+1)
	}
	for i := n; i >= 0; i-- {
		for j := m; j >= 0; j-- {
			switch {
			case i == n && j == m:
				continue
			case i == n:
				cost[i][j] = cost[i][j+1] + 1
			case j == m:
				cost[i][j] = cost[i+1][j] + 1
			default:
				sub := subCost(compare(ref[i], ans[j]))
				cost[i][j] = min(cost[i+1][j+1]+sub, cost[i+1][j]+1, cost[i][j+1]+1)
			}
		}
	}

	res := Result{Tokens: []Token{}}
	var earned float64
	extras := 0
	for i, j := 0, 0; i < n || j < m; {
		switch {
		case i < n && j < m && cost[i][j] == cost[i+1][j+1]+subCost(compare(ref[i], ans[j])):
			st := compare(ref[i], ans[j])
			res.Tokens = append(res.Tokens, Token{Text: ans[j], Expected: ref[i], Status: st})
			earned += credit[st]
			i, j = i+1, j+1
		case i < n && cost[i][j] == cost[i+1][j]+1:
			res.Tokens = append(res.Tokens, Token{Expected: ref[i], Status: Missing})
			i++
		default:
			res.Tokens = append(res.Tokens, Token{Text: ans[j], Status: Extra})
			extras++
			j++
		}
	}
	if n > 0 {
		res.Score = float64(int(earned/float64(n+extras)*1000+0.5)) / 10
	}
	res.Passed = res.Score >= PassScore
	return res
}

func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur := make([]int, len(rb)+1)
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			c := 1
			if ra[i-1] == rb[j-1] {
				c = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+c)
		}
		prev = cur
	}
	return prev[len(rb)]
}
