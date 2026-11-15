package openai

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"unicode"
)

// The model writes each listening question with the exact script sentence it
// is about and the correct option as text (never an index: models often point
// at the wrong option). The server then checks every answer against the
// script, puts the questions in the order the recording answers them, drops
// questions about a sentence already asked about, and has the model answer the
// multiple-choice questions again from the script alone; any question it does
// not answer the same way is dropped.

var listeningSchema = ordered(
	prop("title", str("German title")),
	prop("situation", str("One Vietnamese sentence describing the situation, shown before listening")),
	prop("speakers", arr(ordered(
		prop("name", str("First name")),
		prop("gender", map[string]any{"type": "string", "enum": []string{"female", "male"}}),
	))),
	prop("segments", arr(ordered(
		prop("speaker", str("Name of one of the speakers")),
		prop("text", str("What they say, in German")),
	))),
	prop("questions", arr(ordered(
		prop("kind", map[string]any{"type": "string", "enum": []string{"choice", "blank"}}),
		prop("quote", str("The sentence of the script, copied word for word, that this question is about (the sentence that gives the answer)")),
		prop("question", str("choice: a German question answered by quote. blank: quote with 1-3 consecutive words replaced by a single ___")),
		prop("correct", str("choice: the correct option in German, as stated in quote. blank: empty")),
		prop("distractors", strs("choice: exactly 3 German options that are definitely wrong according to the script. blank: empty")),
		prop("accepted", strs("blank: first the exact missing words as spoken in quote, then any equally correct variants. choice: empty")),
		prop("explanation", str("Short English explanation, pointing to what is said; it must agree with the answer")),
	))),
)

type rawListeningQuestion struct {
	Kind        string   `json:"kind"`
	Quote       string   `json:"quote"`
	Question    string   `json:"question"`
	Correct     string   `json:"correct"`
	Distractors []string `json:"distractors"`
	Accepted    []string `json:"accepted"`
	Explanation string   `json:"explanation"`
}

// listeningExtra questions are asked for on top of the wanted number, so
// dropping wrong or repeated ones still leaves enough.
const listeningExtra = 3

func (c *Client) GrammarListening(ctx context.Context, m Model, r GrammarRequest) (*Listening, *Usage, error) {
	n := r.Sections.Listening
	prompt := textIntro(r, "spoken German") + fmt.Sprintf(
		"Write a German listening script of a real everyday situation: a conversation between 2 speakers (one female, one male) of about %s turns, "+
			"or a short radio report, announcement or podcast by 1 speaker. Make it sound like real speech: the speakers react to each other "+
			"(questions, agreement, surprise, follow-ups), turns vary in length, and they use natural spoken phrases (e.g. \"Ach so\", \"na ja\", \"genau\", \"echt?\") in moderation. "+
			"Keep it accurate and consistent: facts, times and numbers must not contradict each other. Plain text only, no stage directions or sound descriptions. "+
			"Then exactly %d questions, about half \"choice\" (comprehension, 4 options) and half \"blank\" (a sentence quoted word for word from the script with 1-3 words replaced by ___; prefer words showing the grammar point).\n"+
			"Order and coverage: the learner answers while listening, so list the questions in the order the recording gives their answers, "+
			"spread over the whole recording from beginning to end. Each question is about a different sentence of the script and asks about different information: "+
			"never ask the same thing twice, not even as one choice and one blank question.\n"+
			"For \"choice\" questions: "+singleAnswer+
			"The correct option must follow from what is actually said in quote, not from guessing or world knowledge; check it against the script before writing it.\n"+
			"For \"blank\" questions: the question is quote with the gap; putting the first accepted answer into the gap must give quote exactly.\n",
		listeningLines[r.Level], n+listeningExtra)
	var raw struct {
		Title     string                 `json:"title"`
		Situation string                 `json:"situation"`
		Speakers  []Speaker              `json:"speakers"`
		Segments  []Segment              `json:"segments"`
		Questions []rawListeningQuestion `json:"questions"`
	}
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_listening", listeningSchema, 0.8, &raw)
	if err != nil {
		return nil, u, err
	}
	if len(raw.Segments) == 0 {
		return nil, u, fmt.Errorf("listening script is empty")
	}
	out := &Listening{Title: raw.Title, Situation: raw.Situation, Speakers: raw.Speakers, Segments: raw.Segments}
	qs := orderListening(raw.Segments, raw.Questions)

	// Second opinion on the multiple-choice answers.
	var choices []ChoiceQuestion
	var at []int
	for i, q := range qs {
		if q.Kind == "choice" {
			choices = append(choices, ChoiceQuestion{Question: q.Question, Options: q.Options, Answer: q.Answer})
			at = append(at, i)
		}
	}
	if len(choices) > 0 {
		var ok []bool
		var cu *Usage
		ok, cu, err = c.checkChoices(ctx, m, "Transcript of the recording:\n"+scriptText(raw.Segments), choices)
		u = addUsage(u, cu)
		if err != nil {
			log.Printf("listening answer check: %v", err) // keep the questions: they passed the script checks
		} else {
			drop := map[int]bool{}
			for k, i := range at {
				drop[i] = !ok[k]
			}
			var keep []ListeningQuestion
			for i, q := range qs {
				if !drop[i] {
					keep = append(keep, q)
				}
			}
			qs = keep
		}
	}
	out.Questions = spread(qs, n)
	return out, u, nil
}

// choiceExtra questions are asked for on top of the wanted number, so
// dropping doubtful ones still leaves enough.
const choiceExtra = 2

// toChoices builds the options from the correct answer and the distractors,
// drops malformed questions and shuffles the options.
func toChoices(raw []rawChoice) []ChoiceQuestion {
	var out []ChoiceQuestion
	for _, r := range raw {
		opts := []string{strings.TrimSpace(r.Correct)}
		for _, d := range r.Distractors {
			if d = strings.TrimSpace(d); d != "" {
				opts = append(opts, d)
			}
		}
		if len(opts) > 4 {
			opts = opts[:4]
		}
		q := ChoiceQuestion{Question: strings.TrimSpace(r.Question), Explanation: r.Explanation}
		if q.Question == "" || !validOptions(opts, 0) {
			continue
		}
		q.Options, q.Answer = shuffleOptions(opts, 0)
		out = append(out, q)
	}
	return out
}

// verifyChoices drops the questions a second, independent answering does not
// confirm. If the check itself fails, the questions are kept.
func (c *Client) verifyChoices(ctx context.Context, m Model, source string, qs []ChoiceQuestion, u *Usage) ([]ChoiceQuestion, *Usage) {
	if len(qs) == 0 {
		return qs, u
	}
	ok, cu, err := c.checkChoices(ctx, m, source, qs)
	u = addUsage(u, cu)
	if err != nil {
		log.Printf("answer check: %v", err)
		return qs, u
	}
	var keep []ChoiceQuestion
	for i, q := range qs {
		if ok[i] {
			keep = append(keep, q)
		}
	}
	return keep, u
}

var choiceCheckSchema = ordered(prop("answers", arr(ordered(
	prop("n", integer("Question number")),
	prop("reasoning", str("One short sentence: what decides the answer")),
	prop("answer", str("The full text of the one correct option, copied exactly")),
	prop("sure", map[string]any{"type": "boolean", "description": "false if no option is correct or more than one option could be accepted"}),
))))

// checkChoices has the model answer the questions again without seeing the
// intended answers; ok[i] is true when it picks the same option and is sure.
func (c *Client) checkChoices(ctx context.Context, m Model, source string, qs []ChoiceQuestion) (ok []bool, u *Usage, err error) {
	var b strings.Builder
	b.WriteString("Answer these German multiple-choice questions carefully. Exactly one option should be correct. ")
	if source != "" {
		b.WriteString("Answer comprehension questions using only what the text below says.\n\n" + source + "\n")
	} else {
		b.WriteString("Judge each by correct standard German grammar and meaning.\n")
	}
	b.WriteString("\nQuestions:\n")
	for i, q := range qs {
		fmt.Fprintf(&b, "%d. %s\n", i+1, q.Question)
		for j, o := range q.Options {
			fmt.Fprintf(&b, "   %c) %s\n", 'A'+j, o)
		}
	}
	var out struct {
		Answers []struct {
			N      int    `json:"n"`
			Answer string `json:"answer"`
			Sure   bool   `json:"sure"`
		} `json:"answers"`
	}
	if u, err = c.chatJSONWith(ctx, c.slow, m, grammarSystem, b.String(), "grammar_answer_check", choiceCheckSchema, 0, &out); err != nil {
		return nil, u, err
	}
	ok = make([]bool, len(qs))
	for _, a := range out.Answers {
		i := a.N - 1
		if i < 0 || i >= len(qs) || !a.Sure {
			continue
		}
		ok[i] = normText(stripOptionLetter(a.Answer)) == normText(qs[i].Options[qs[i].Answer])
	}
	for i, q := range qs {
		if !ok[i] {
			log.Printf("answer check: dropped %q (intended %q)", q.Question, q.Options[q.Answer])
		}
	}
	return ok, u, nil
}

func scriptText(segs []Segment) string {
	var b strings.Builder
	for _, s := range segs {
		fmt.Fprintf(&b, "%s: %s\n", s.Speaker, s.Text)
	}
	return b.String()
}

// stripOptionLetter removes a leading "B) " the checker may copy.
func stripOptionLetter(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 2 && s[0] >= 'A' && s[0] <= 'D' && (s[1] == ')' || s[1] == '.') {
		return strings.TrimSpace(s[2:])
	}
	return s
}

func addUsage(a, b *Usage) *Usage {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	}
	return &Usage{Model: a.Model, InputTokens: a.InputTokens + b.InputTokens, OutputTokens: a.OutputTokens + b.OutputTokens, CostUSD: a.CostUSD + b.CostUSD}
}

// normText compares German text ignoring case, punctuation and spacing.
func normText(s string) string {
	var b strings.Builder
	space := true
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			space = false
		} else if !space {
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

// script is the normalized transcript with where each segment starts, so a
// quote can be placed in the recording.
type script struct {
	text   string
	starts []int
}

func newScript(segs []Segment) script {
	var sc script
	for _, s := range segs {
		t := normText(s.Text)
		if t == "" {
			continue
		}
		if sc.text != "" {
			sc.text += " "
		}
		sc.starts = append(sc.starts, len(sc.text))
		sc.text += t
	}
	return sc
}

// find returns the span of quote in the script, matched on whole words.
func (sc script) find(quote string) (start, end int, ok bool) {
	q := normText(quote)
	if q == "" {
		return 0, 0, false
	}
	hay := " " + sc.text + " "
	i := strings.Index(hay, " "+q+" ")
	if i < 0 {
		return 0, 0, false
	}
	return i, i + len(q), true
}

// segmentSpan is the span of the segment sharing the most words with quote,
// for quotes the model did not copy exactly (at least 70% of its words).
func (sc script) segmentSpan(quote string) (start, end int, ok bool) {
	words := strings.Fields(normText(quote))
	if len(words) == 0 {
		return 0, 0, false
	}
	best, bestAt := 0.0, -1
	for k, st := range sc.starts {
		en := len(sc.text)
		if k+1 < len(sc.starts) {
			en = sc.starts[k+1] - 1
		}
		have := map[string]bool{}
		for _, w := range strings.Fields(sc.text[st:en]) {
			have[w] = true
		}
		hit := 0
		for _, w := range words {
			if have[w] {
				hit++
			}
		}
		if f := float64(hit) / float64(len(words)); f > best {
			best, bestAt = f, k
		}
	}
	if best < 0.7 {
		return 0, 0, false
	}
	st := sc.starts[bestAt]
	en := len(sc.text)
	if bestAt+1 < len(sc.starts) {
		en = sc.starts[bestAt+1] - 1
	}
	return st, en, true
}

type placed struct {
	q          ListeningQuestion
	start, end int
}

// orderListening checks each question against the script, shuffles the
// choice options, sorts the questions by where the recording answers them and
// drops questions about a sentence that was already asked about.
func orderListening(segs []Segment, raw []rawListeningQuestion) []ListeningQuestion {
	sc := newScript(segs)
	var ps []placed
	seen := map[string]bool{}
	for _, r := range raw {
		q, st, en, ok := checkQuestion(sc, r)
		if !ok {
			log.Printf("listening: dropped question that does not match the script: %q", r.Question)
			continue
		}
		key := q.Kind + "|" + normText(q.Question)
		if seen[key] {
			continue
		}
		seen[key] = true
		ps = append(ps, placed{q, st, en})
	}
	slices.SortStableFunc(ps, func(a, b placed) int { return a.start - b.start })
	var out []ListeningQuestion
	var kept []placed
	for _, p := range ps {
		if slices.ContainsFunc(kept, func(k placed) bool { return overlaps(k, p) }) {
			continue // the same sentence again: it would ask the same thing twice
		}
		kept = append(kept, p)
		out = append(out, p.q)
	}
	return out
}

// overlaps: the two spans share more than half of the shorter one.
func overlaps(a, b placed) bool {
	lo, hi := max(a.start, b.start), min(a.end, b.end)
	if hi <= lo {
		return false
	}
	return 2*(hi-lo) > min(a.end-a.start, b.end-b.start)
}

func checkQuestion(sc script, r rawListeningQuestion) (q ListeningQuestion, start, end int, ok bool) {
	q = ListeningQuestion{Kind: r.Kind, Question: strings.TrimSpace(r.Question), Explanation: r.Explanation}
	switch r.Kind {
	case "choice":
		correct := strings.TrimSpace(r.Correct)
		opts := []string{correct}
		for _, d := range r.Distractors {
			if d = strings.TrimSpace(d); d != "" {
				opts = append(opts, d)
			}
		}
		if q.Question == "" || len(opts) < 2 || !validOptions(opts, 0) {
			return q, 0, 0, false
		}
		if len(opts) > 4 {
			opts = opts[:4]
		}
		if start, end, ok = sc.find(r.Quote); !ok {
			if start, end, ok = sc.segmentSpan(r.Quote); !ok {
				return q, 0, 0, false
			}
		}
		q.Options, q.Answer = shuffleOptions(opts, 0)
		q.Accepted = []string{}
		return q, start, end, true
	case "blank":
		if strings.Count(q.Question, "___") != 1 {
			return q, 0, 0, false
		}
		// The spoken words must turn the gapped sentence back into the script.
		var accepted []string
		found := false
		for _, a := range r.Accepted {
			a = strings.TrimSpace(a)
			if a == "" || slices.Contains(accepted, a) {
				continue
			}
			if !found {
				if s, e, hit := sc.find(strings.Replace(q.Question, "___", a, 1)); hit {
					start, end, found = s, e, true
					accepted = append([]string{a}, accepted...)
					continue
				}
			}
			accepted = append(accepted, a)
		}
		if !found {
			return q, 0, 0, false
		}
		q.Accepted, q.Options, q.Answer = accepted, []string{}, -1
		return q, start, end, true
	}
	return q, 0, 0, false
}

// spread keeps n items spread evenly over the list, in order.
func spread[T any](xs []T, n int) []T {
	if len(xs) <= n {
		if xs == nil {
			return []T{}
		}
		return xs
	}
	out := make([]T, n)
	for i := range n {
		out[i] = xs[i*len(xs)/n]
	}
	return out
}
