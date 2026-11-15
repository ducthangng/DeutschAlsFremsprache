package openai

import (
	"context"
	"fmt"
	"math/rand/v2"
	"regexp"
	"slices"
	"strings"
)

// Model is a chat model the learner can pick for grammar exercises, with its
// list price (USD per 1M tokens) for cost tracking.
type Model struct {
	ID            string  `json:"id"`
	Label         string  `json:"label"`
	Note          string  `json:"note"`
	USDPerMInput  float64 `json:"usdPerMInput"`
	USDPerMOutput float64 `json:"usdPerMOutput"`
	// PriceEstimated marks prices not confirmed against OpenAI's price list.
	PriceEstimated bool `json:"priceEstimated"`
	// ReasoningEffort is sent to reasoning models ("" = parameter omitted).
	// "low" keeps exercise generation fast; quality is plenty for drills.
	ReasoningEffort string `json:"-"`
}

// GrammarModels are the strong chat models allowed to design exercises
// (support structured output on Chat Completions). Smaller and older models
// (mini, nano, chat, o4-mini, 4o) are left out: they too often write
// questions with two defensible answers. The first one is the default.
var GrammarModels = []Model{
	{ID: "gpt-5.1", Label: "GPT-5.1", Note: "Chất lượng cao", USDPerMInput: 1.25, USDPerMOutput: 10.00, ReasoningEffort: "low"},
	{ID: "gpt-5.4-2026-03-05", Label: "GPT-5.4", Note: "Chất lượng cao, mới hơn", USDPerMInput: 2.50, USDPerMOutput: 15.00, PriceEstimated: true, ReasoningEffort: "low"},
	{ID: "gpt-5.5-2026-04-23", Label: "GPT-5.5", Note: "Chất lượng rất cao, đắt", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true, ReasoningEffort: "low"},
	{ID: "gpt-5.6-luna", Label: "GPT-5.6 Luna", Note: "Model mới", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true},
	{ID: "gpt-5.6-sol", Label: "GPT-5.6 Sol", Note: "Model mới", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true},
}

// GrammarModel looks up a model by id.
func GrammarModel(id string) (Model, bool) {
	i := slices.IndexFunc(GrammarModels, func(m Model) bool { return m.ID == id })
	if i < 0 {
		return Model{}, false
	}
	return GrammarModels[i], true
}

// ---- exercise content (stored as JSON and sent to the browser as is) ----

type ChoiceQuestion struct {
	Question    string   `json:"question"`
	Options     []string `json:"options"`
	Answer      int      `json:"answer"` // index into Options
	Explanation string   `json:"explanation"`
}

type RearrangeQuestion struct {
	Fragments    []string `json:"fragments"` // shuffled
	Answer       string   `json:"answer"`
	Alternatives []string `json:"alternatives"` // other correct word orders
	Translation  string   `json:"translation"`  // English (German is glossed in English)
	Explanation  string   `json:"explanation"`
}

type Reading struct {
	Title     string           `json:"title"`
	Passage   string           `json:"passage"`
	Questions []ChoiceQuestion `json:"questions"`
}

type Speaker struct {
	Name   string `json:"name"`
	Gender string `json:"gender"` // female | male
}

type Segment struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
}

type ListeningQuestion struct {
	Kind        string   `json:"kind"` // choice | blank
	Question    string   `json:"question"`
	Options     []string `json:"options"`  // choice only
	Answer      int      `json:"answer"`   // choice only
	Accepted    []string `json:"accepted"` // blank only: accepted fillers for "___"
	Explanation string   `json:"explanation"`
}

type Listening struct {
	Title     string              `json:"title"`
	Situation string              `json:"situation"` // Vietnamese
	Speakers  []Speaker           `json:"speakers"`
	Segments  []Segment           `json:"segments"`
	Questions []ListeningQuestion `json:"questions"`
}

type WritingTask struct {
	English string `json:"english"`
	// Address is who "you" in English means: du | ihr | Sie | man ("" = no "you").
	Address      string   `json:"address"`
	German       string   `json:"german"` // reference translation
	Alternatives []string `json:"alternatives"`
	Hint         string   `json:"hint"` // English
}

type GrammarContent struct {
	Title          string              `json:"title"`
	Overview       string              `json:"overview"` // English explanation of the grammar point
	MultipleChoice []ChoiceQuestion    `json:"multipleChoice"`
	Rearrange      []RearrangeQuestion `json:"rearrange"`
	Reading        *Reading            `json:"reading"`
	Listening      *Listening          `json:"listening"`
	Writing        []WritingTask       `json:"writing"`
	// Errors names sections that could not be generated (section → message).
	Errors map[string]string `json:"errors,omitempty"`
}

// GrammarSections are the requested question counts (0 = section not wanted).
type GrammarSections struct {
	MultipleChoice int `json:"multipleChoice"`
	Rearrange      int `json:"rearrange"`
	Reading        int `json:"reading"`
	Listening      int `json:"listening"`
	Writing        int `json:"writing"`
}

type GrammarRequest struct {
	Grammar  string
	Level    string
	Sections GrammarSections
	// Vocabulary to build the items from: the learner's own words, or else
	// the CEFR word list of VocabLevel ("" = same as Level).
	VocabLevel string
	Vocabulary []string
}

// ---- schemas ----

func integer(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}

func strs(desc string) map[string]any {
	return map[string]any{"type": "array", "description": desc, "items": map[string]any{"type": "string"}}
}

// Schemas list what a value depends on first (see fields.MarshalJSON): the
// question before its answer, the answer as text (models often point an
// index at the wrong option) before the wrong options and the explanation.
var choiceSchema = ordered(
	prop("question", str("The question in German; for gap-fill items the sentence with ___ marking the gap")),
	prop("correct", str("The one correct option in German. Decide it first and be certain it is right")),
	prop("distractors", strs("Exactly 3 other options in German, each definitely wrong for this question, all different from correct and from each other")),
	prop("explanation", str("Short explanation in English of why correct is right (and the others wrong), naming the rule; it must agree with correct")),
)

// rawChoice is a multiple-choice question as the model writes it.
type rawChoice struct {
	Question    string   `json:"question"`
	Correct     string   `json:"correct"`
	Distractors []string `json:"distractors"`
	Explanation string   `json:"explanation"`
}

var coreSchema = ordered(
	prop("title", str("Short German title for the exercise set")),
	prop("overview", str("Explanation of the grammar point in English: form, use, 2-3 German examples; 80-160 words, plain text with line breaks")),
	prop("multipleChoice", arr(choiceSchema)),
)

var rearrangeSchema = ordered(prop("items", arr(ordered(
	prop("answer", str("The correct German sentence, with final punctuation")),
	prop("fragments", strs("The words/short chunks of answer without final punctuation, in a scrambled order; joined in the right order they give answer")),
	prop("alternatives", strs("Other fully correct word orders of the same fragments (may be empty)")),
	prop("translation", str("English translation of answer")),
	prop("explanation", str("Short English explanation of the word order rule")),
))))

var readingSchema = ordered(
	prop("title", str("German title of the text")),
	prop("passage", str("The German reading text, paragraphs separated by blank lines")),
	prop("questions", arr(choiceSchema)),
)

var writingSchema = ordered(prop("items", arr(ordered(
	prop("english", str("The English sentence to translate; if it contains you/your/yours/yourself, the form of address is marked right after the first such word: (du), (ihr), (Sie, formal) or (man)")),
	prop("address", map[string]any{"type": "string", "enum": []string{"none", "du", "ihr", "Sie", "man"}, "description": "Who \"you\" refers to: none if the English has no you/your"}),
	prop("german", str("The best German translation")),
	prop("alternatives", strs("Other correct German translations (may be empty)")),
	prop("hint", str("Short English hint about the grammar needed, without giving the answer away")),
))))

// ---- prompts ----

var readingWords = map[string]string{"A1": "100-150", "A2": "120-200", "B1": "150-250", "B2": "200-300", "C1": "200-300", "C2": "200-300"}
var listeningLines = map[string]string{"A1": "10-14", "A2": "12-18", "B1": "14-22", "B2": "16-24", "C1": "18-26", "C2": "18-28"}

const grammarSystem = "You are an experienced teacher of German as a foreign language (DaF) who writes accurate, varied grammar exercises " +
	"for Vietnamese learners. All German must be correct standard German (Hochdeutsch) and match the requested CEFR level. " +
	"Explanations, hints and feedback are written in simple English (German is taught through English); " +
	"only the listening situation is in Vietnamese."

// singleAnswer is the rule every multiple-choice question must follow.
const singleAnswer = "Multiple-choice rule: every question has exactly ONE correct option, and it is definitely correct. " +
	"Each of the other three options must be definitely wrong in this sentence (wrong form, case, ending, word order or meaning), " +
	"never merely less common, less formal or a regional variant. Make the sentence context decide the answer unambiguously " +
	"(e.g. a time marker for tense, a subject for the verb ending). Before answering, check every question: if two options could be " +
	"accepted by a careful teacher, rewrite it. All 4 options are different. The order of options does not matter; it is shuffled afterwards.\n"

func grammarIntro(r GrammarRequest) string {
	return fmt.Sprintf("Grammar point: %s\nLearner level: CEFR %s\n%sEvery item must practise this grammar point; vary situations and sentence patterns, and never repeat an item.\n",
		r.Grammar, r.Level, vocabBrief(r))
}

// textIntro is the brief for the reading and listening texts: unlike drill
// items, a text must read like real German first and show the grammar point
// only where it occurs naturally.
func textIntro(r GrammarRequest, kind string) string {
	vocab := vocabBrief(r)
	if len(r.Vocabulary) > 0 {
		vocab = "Vocabulary: where they fit the situation naturally, use some of these words from the learner's own list " +
			"(inflect them as needed); never force a word in just to use it: " + strings.Join(r.Vocabulary, "; ") + "\n"
	}
	return fmt.Sprintf("Grammar point: %s\nLearner level: CEFR %s\n%s", r.Grammar, r.Level, vocab) +
		"Naturalness comes first. Write " + kind + " a native speaker would really produce in this situation: realistic content and details, " +
		"a natural flow of ideas, idiomatic everyday wording at the learner's level. Use the grammar point where a native speaker naturally would " +
		"(a few times is enough); never bend a sentence to fit it in, never put it in every sentence, and avoid stilted textbook sentences, " +
		"forced repetition and lists of unconnected facts. All German must be correct and sound natural to a native speaker.\n"
}

func vocabBrief(r GrammarRequest) string {
	if len(r.Vocabulary) > 0 {
		return "Vocabulary: build the items around these words from the learner's own list, using as many of them as fit naturally " +
			"(inflect them as the sentence needs); other words should stay simple: " + strings.Join(r.Vocabulary, "; ") + "\n"
	}
	level := r.VocabLevel
	if level == "" {
		level = r.Level
	}
	return fmt.Sprintf("Vocabulary: use words from the CEFR %s word list (Goethe/telc %s Wortschatz), varied across items.\n", level, level)
}

// GrammarCore writes the title, the explanation and the multiple-choice questions.
func (c *Client) GrammarCore(ctx context.Context, m Model, r GrammarRequest) (title, overview string, qs []ChoiceQuestion, u *Usage, err error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write a German title for the exercise set, an English overview of the grammar point, and exactly %d multiple-choice questions. "+
			"Mix gap-fill sentences (with ___) and short questions; each has 4 plausible options that differ in the targeted form.\n"+singleAnswer,
		r.Sections.MultipleChoice+choiceExtra)
	var out struct {
		Title          string      `json:"title"`
		Overview       string      `json:"overview"`
		MultipleChoice []rawChoice `json:"multipleChoice"`
	}
	u, err = c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_core", coreSchema, 0.7, &out)
	if err != nil {
		return "", "", nil, u, err
	}
	qs = toChoices(out.MultipleChoice)
	qs, u = c.verifyChoices(ctx, m, "", qs, u)
	return out.Title, out.Overview, spread(qs, r.Sections.MultipleChoice), u, nil
}

func (c *Client) GrammarRearrange(ctx context.Context, m Model, r GrammarRequest) ([]RearrangeQuestion, *Usage, error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write exactly %d sentence-rearranging tasks where word order is decided by the grammar point. "+
			"Split each sentence into 4-10 words or short chunks (keep separable particles, articles with their nouns only if natural).",
		r.Sections.Rearrange)
	var out struct{ Items []RearrangeQuestion }
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_rearrange", rearrangeSchema, 0.7, &out)
	if err != nil {
		return nil, u, err
	}
	var items []RearrangeQuestion
	for _, it := range out.Items {
		if strings.TrimSpace(it.Answer) == "" || len(it.Fragments) < 2 {
			continue
		}
		it.Fragments = scramble(it.Fragments)
		items = append(items, it)
	}
	return capped(items, r.Sections.Rearrange), u, nil
}

func (c *Client) GrammarReading(ctx context.Context, m Model, r GrammarRequest) (*Reading, *Usage, error) {
	prompt := textIntro(r, "a text") + fmt.Sprintf(
		"Write a German reading text of about %s words, of a kind people really read (an email, a blog post, a short newspaper article, a forum post, a story), "+
			"with a clear topic and a natural structure for that kind of text. "+
			"Then exactly %d multiple-choice comprehension questions in German, in the order the text answers them. Questions check understanding of the text; some may hinge on the grammar point. "+
			"The text must clearly support the one correct option and clearly rule out the others.\n"+singleAnswer,
		readingWords[r.Level], r.Sections.Reading+choiceExtra)
	var raw struct {
		Title     string      `json:"title"`
		Passage   string      `json:"passage"`
		Questions []rawChoice `json:"questions"`
	}
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_reading", readingSchema, 0.8, &raw)
	if err != nil {
		return nil, u, err
	}
	qs, u := c.verifyChoices(ctx, m, "Text:\n"+raw.Passage, toChoices(raw.Questions), u)
	return &Reading{Title: raw.Title, Passage: raw.Passage, Questions: spread(qs, r.Sections.Reading)}, u, nil
}

// youRule: English "you" can be du, ihr, Sie or man in German, so the
// learner is told which one is wanted.
const youRule = "Form of address: English \"you\" is ambiguous, so whenever an English sentence contains you/your/yours/yourself/yourselves, " +
	"decide who is addressed and write it in brackets right after the first such word: (du) for one friend, family member or child; " +
	"(ihr) for several people one is informal with; (Sie, formal) for polite address to one or more people (strangers, customers, a boss); " +
	"(man) for a generic \"you\" meaning people in general. Make the situation fit the choice, vary the forms across the set, and set address to match. " +
	"german and every alternative must use exactly that form of address (pronoun, possessive and verb ending, e.g. Sie haben / Ihr Auto); " +
	"never give an alternative with a different form of address. If the English has no \"you\", address is none and nothing is marked.\n"

var youWord = regexp.MustCompile(`(?i)\byou(?:r|rs|rself|rselves)?\b`)

var addressMark = map[string]string{"du": "(du)", "ihr": "(ihr)", "Sie": "(Sie, formal)", "man": "(man)"}

// markAddress makes sure a sentence with "you" says which German form is
// wanted (the marker is added after the first "you" if the model left it
// out); a "you" sentence without a form of address is dropped.
func markAddress(it WritingTask) (WritingTask, bool) {
	if it.Address == "none" {
		it.Address = ""
	}
	loc := youWord.FindStringIndex(it.English)
	if loc == nil {
		it.Address = ""
		return it, true
	}
	mark, ok := addressMark[it.Address]
	if !ok {
		return it, false
	}
	if !strings.Contains(strings.ToLower(it.English), "("+strings.ToLower(it.Address)) {
		it.English = it.English[:loc[1]] + " " + mark + it.English[loc[1]:]
	}
	return it, true
}

func (c *Client) GrammarWriting(ctx context.Context, m Model, r GrammarRequest) ([]WritingTask, *Usage, error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write exactly %d English sentences for the learner to translate into German. Each translation must require the grammar point. "+
			"Keep the English natural and unambiguous.\n"+youRule,
		r.Sections.Writing)
	var out struct{ Items []WritingTask }
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_writing", writingSchema, 0.7, &out)
	if err != nil {
		return nil, u, err
	}
	var items []WritingTask
	for _, it := range out.Items {
		if strings.TrimSpace(it.English) != "" && strings.TrimSpace(it.German) != "" {
			if it, ok := markAddress(it); ok {
				items = append(items, it)
			}
		}
	}
	return capped(items, r.Sections.Writing), u, nil
}

func capped[T any](xs []T, n int) []T {
	if xs == nil {
		xs = []T{}
	}
	if len(xs) > n {
		xs = xs[:n]
	}
	return xs
}

// validOptions: at least 2 options, all different, and the answer points at one.
func validOptions(opts []string, answer int) bool {
	if len(opts) < 2 || answer < 0 || answer >= len(opts) {
		return false
	}
	seen := map[string]bool{}
	for _, o := range opts {
		k := strings.ToLower(strings.TrimSpace(o))
		if k == "" || seen[k] {
			return false
		}
		seen[k] = true
	}
	return true
}

// shuffleOptions puts the options in random order (models favour putting the
// right answer first) and returns where the answer ended up.
func shuffleOptions(opts []string, answer int) ([]string, int) {
	perm := rand.Perm(len(opts))
	out := make([]string, len(opts))
	at := 0
	for i, p := range perm {
		out[i] = opts[p]
		if p == answer {
			at = i
		}
	}
	return out, at
}

// scramble shuffles fragments so they never come out in the original order.
func scramble(fs []string) []string {
	out := slices.Clone(fs)
	for range 5 {
		rand.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
		if !slices.Equal(out, fs) {
			break
		}
	}
	return out
}

// ---- grading translations ----

type WritingAnswer struct {
	English   string
	Reference string
	Answer    string
}

type WritingFeedback struct {
	Score     int    `json:"score"`   // 0-10
	Verdict   string `json:"verdict"` // correct | minor | wrong
	Corrected string `json:"corrected"`
	Feedback  string `json:"feedback"`
}

var writingFeedbackSchema = ordered(prop("items", arr(ordered(
	prop("corrected", str("The learner's sentence with the fewest changes that make it correct; the answer itself if already correct")),
	prop("feedback", str("1-2 sentences in simple English: what is wrong and why, focusing on the grammar point; praise briefly if correct")),
	prop("verdict", map[string]any{"type": "string", "enum": []string{"correct", "minor", "wrong"}}),
	prop("score", integer("0-10: 10 fully correct and natural, 7-9 small slips (spelling, a missing comma), 4-6 one real grammar error, 0-3 wrong or missing")),
))))

// GradeWriting marks the learner's German translations, one result per answer.
func (c *Client) GradeWriting(ctx context.Context, m Model, grammar, level string, answers []WritingAnswer) ([]WritingFeedback, *Usage, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Grade a CEFR %s learner's English → German translations. Grammar point being practised: %s\n", level, grammar)
	b.WriteString("Accept any correct, natural translation, not only the reference. Empty answers score 0. Return exactly one result per item, in order.\n" +
		"When the English marks the form of address after \"you\" ((du), (ihr), (Sie, formal) or (man)), the learner must use exactly that form " +
		"(pronoun, possessive and verb ending); using another form is a real error (score at most 5) and the feedback says which form was asked for.\n\n")
	for i, a := range answers {
		fmt.Fprintf(&b, "%d. English: %s\n   Reference: %s\n   Learner: %s\n", i+1, a.English, a.Reference, a.Answer)
	}
	var out struct{ Items []WritingFeedback }
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, b.String(), "writing_feedback", writingFeedbackSchema, 0.2, &out)
	if err != nil {
		return nil, u, err
	}
	if len(out.Items) != len(answers) {
		return nil, u, fmt.Errorf("expected %d gradings, got %d", len(answers), len(out.Items))
	}
	for i := range out.Items {
		out.Items[i].Score = min(10, max(0, out.Items[i].Score))
	}
	return out.Items, u, nil
}
