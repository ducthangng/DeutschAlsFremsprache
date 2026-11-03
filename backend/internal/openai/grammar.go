package openai

import (
	"context"
	"fmt"
	"math/rand/v2"
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

// GrammarModels are the account's chat models that support structured output
// on Chat Completions. The first one is the default. Realtime, audio,
// transcription, moderation, search, codex and *-pro models (Responses API
// only) are left out, as are older models without strict JSON schemas.
var GrammarModels = []Model{
	{ID: "gpt-5-mini", Label: "GPT-5 mini", Note: "Cân bằng chất lượng và chi phí", USDPerMInput: 0.25, USDPerMOutput: 2.00, ReasoningEffort: "low"},
	{ID: "gpt-5-nano", Label: "GPT-5 nano", Note: "Rẻ và nhanh nhất", USDPerMInput: 0.05, USDPerMOutput: 0.40, ReasoningEffort: "low"},
	{ID: "gpt-5.1", Label: "GPT-5.1", Note: "Chất lượng cao", USDPerMInput: 1.25, USDPerMOutput: 10.00, ReasoningEffort: "low"},
	{ID: "gpt-5.4-mini", Label: "GPT-5.4 mini", Note: "Bản mini mới hơn", USDPerMInput: 0.75, USDPerMOutput: 4.50, PriceEstimated: true, ReasoningEffort: "low"},
	{ID: "gpt-5.4-2026-03-05", Label: "GPT-5.4", Note: "Chất lượng cao", USDPerMInput: 2.50, USDPerMOutput: 15.00, PriceEstimated: true, ReasoningEffort: "low"},
	{ID: "gpt-5.5-2026-04-23", Label: "GPT-5.5", Note: "Chất lượng rất cao, đắt", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true, ReasoningEffort: "low"},
	{ID: "gpt-5.6-luna", Label: "GPT-5.6 Luna", Note: "Model mới", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true},
	{ID: "gpt-5.6-sol", Label: "GPT-5.6 Sol", Note: "Model mới", USDPerMInput: 5.00, USDPerMOutput: 30.00, PriceEstimated: true},
	{ID: "gpt-5-chat-latest", Label: "GPT-5 Chat", Note: "Không suy luận, trả lời nhanh", USDPerMInput: 1.25, USDPerMOutput: 10.00},
	{ID: "o4-mini-2025-04-16", Label: "o4-mini", Note: "Model suy luận cũ", USDPerMInput: 1.10, USDPerMOutput: 4.40, ReasoningEffort: "low"},
	{ID: "gpt-4o-2024-11-20", Label: "GPT-4o", Note: "Không suy luận", USDPerMInput: 2.50, USDPerMOutput: 10.00},
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
	Translation  string   `json:"translation"`  // Vietnamese
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
	English      string   `json:"english"`
	German       string   `json:"german"` // reference translation
	Alternatives []string `json:"alternatives"`
	Hint         string   `json:"hint"` // Vietnamese
}

type GrammarContent struct {
	Title          string              `json:"title"`
	Overview       string              `json:"overview"` // Vietnamese explanation of the grammar point
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
}

// ---- schemas ----

func integer(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}

func strs(desc string) map[string]any {
	return map[string]any{"type": "array", "description": desc, "items": map[string]any{"type": "string"}}
}

var choiceSchema = obj(map[string]any{
	"question":    str("The question in German; for gap-fill items the sentence with ___ marking the gap"),
	"options":     strs("Exactly 4 answer options in German"),
	"answer":      integer("0-based index of the single correct option"),
	"explanation": str("Short explanation in Vietnamese of why the answer is right, naming the rule"),
})

var coreSchema = obj(map[string]any{
	"title":          str("Short German title for the exercise set"),
	"overview":       str("Explanation of the grammar point in Vietnamese: form, use, 2-3 German examples; 80-160 words, plain text with line breaks"),
	"multipleChoice": arr(choiceSchema),
})

var rearrangeSchema = obj(map[string]any{
	"items": arr(obj(map[string]any{
		"answer":       str("The correct German sentence, with final punctuation"),
		"fragments":    strs("The words/short chunks of answer without final punctuation, in a scrambled order; joined in the right order they give answer"),
		"alternatives": strs("Other fully correct word orders of the same fragments (may be empty)"),
		"translation":  str("Vietnamese translation of answer"),
		"explanation":  str("Short Vietnamese explanation of the word order rule"),
	})),
})

var readingSchema = obj(map[string]any{
	"title":     str("German title of the text"),
	"passage":   str("The German reading text, paragraphs separated by blank lines"),
	"questions": arr(choiceSchema),
})

var listeningSchema = obj(map[string]any{
	"title":     str("German title"),
	"situation": str("One Vietnamese sentence describing the situation, shown before listening"),
	"speakers": arr(obj(map[string]any{
		"name":   str("First name"),
		"gender": map[string]any{"type": "string", "enum": []string{"female", "male"}},
	})),
	"segments": arr(obj(map[string]any{
		"speaker": str("Name of one of the speakers"),
		"text":    str("What they say, in German"),
	})),
	"questions": arr(obj(map[string]any{
		"kind":        map[string]any{"type": "string", "enum": []string{"choice", "blank"}},
		"question":    str("choice: a German question about the recording. blank: a sentence quoted from the recording with ___ replacing 1-3 words"),
		"options":     strs("choice: exactly 4 German options. blank: empty"),
		"answer":      integer("choice: 0-based index of the correct option. blank: -1"),
		"accepted":    strs("blank: the exact missing words as spoken, plus any equally correct variants. choice: empty"),
		"explanation": str("Short Vietnamese explanation"),
	})),
})

var writingSchema = obj(map[string]any{
	"items": arr(obj(map[string]any{
		"english":      str("The English sentence to translate"),
		"german":       str("The best German translation"),
		"alternatives": strs("Other correct German translations (may be empty)"),
		"hint":         str("Short Vietnamese hint about the grammar needed, without giving the answer away"),
	})),
})

// ---- prompts ----

var readingWords = map[string]string{"A1": "100-150", "A2": "150-200", "B1": "200-280", "B2": "280-350", "C1": "350-450", "C2": "400-500"}
var listeningLines = map[string]string{"A1": "8-10", "A2": "10-12", "B1": "12-16", "B2": "14-18", "C1": "16-20", "C2": "16-22"}

const grammarSystem = "You are an experienced teacher of German as a foreign language (DaF) who writes accurate, varied grammar exercises " +
	"for Vietnamese learners. All German must be correct standard German (Hochdeutsch) and match the requested CEFR level. " +
	"Explanations are written in Vietnamese."

func grammarIntro(r GrammarRequest) string {
	return fmt.Sprintf("Grammar point: %s\nLearner level: CEFR %s\nEvery item must practise this grammar point; vary vocabulary, situations and sentence patterns, and never repeat an item.\n",
		r.Grammar, r.Level)
}

// GrammarCore writes the title, the explanation and the multiple-choice questions.
func (c *Client) GrammarCore(ctx context.Context, m Model, r GrammarRequest) (title, overview string, qs []ChoiceQuestion, u *Usage, err error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write a German title for the exercise set, a Vietnamese overview of the grammar point, and exactly %d multiple-choice questions. "+
			"Mix gap-fill sentences (with ___) and short questions; each has 4 plausible options that differ in the targeted form, exactly one correct.",
		r.Sections.MultipleChoice)
	var out struct {
		Title          string           `json:"title"`
		Overview       string           `json:"overview"`
		MultipleChoice []ChoiceQuestion `json:"multipleChoice"`
	}
	u, err = c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_core", coreSchema, 0.7, &out)
	if err != nil {
		return "", "", nil, u, err
	}
	return out.Title, out.Overview, cleanChoices(out.MultipleChoice, r.Sections.MultipleChoice), u, nil
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
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write a German reading text of %s words (an article, story, email or blog post) that uses the grammar point many times naturally, "+
			"then exactly %d multiple-choice comprehension questions in German. Questions check understanding of the text; several should hinge on the grammar point.",
		readingWords[r.Level], r.Sections.Reading)
	var out Reading
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_reading", readingSchema, 0.8, &out)
	if err != nil {
		return nil, u, err
	}
	out.Questions = cleanChoices(out.Questions, r.Sections.Reading)
	return &out, u, nil
}

func (c *Client) GrammarListening(ctx context.Context, m Model, r GrammarRequest) (*Listening, *Usage, error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write a German listening script: a natural conversation between 2 speakers (one female, one male) of %s turns, "+
			"or a short radio announcement/podcast by 1 speaker, that uses the grammar point many times. No stage directions. "+
			"Then exactly %d questions, about half \"choice\" (comprehension, 4 options) and half \"blank\" (a sentence quoted word for word from the script with 1-3 words replaced by ___; prefer words showing the grammar point).",
		listeningLines[r.Level], r.Sections.Listening)
	var out Listening
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_listening", listeningSchema, 0.8, &out)
	if err != nil {
		return nil, u, err
	}
	var qs []ListeningQuestion
	for _, q := range out.Questions {
		switch q.Kind {
		case "choice":
			if len(q.Options) < 2 || q.Answer < 0 || q.Answer >= len(q.Options) {
				continue
			}
			q.Accepted = []string{}
		case "blank":
			if !strings.Contains(q.Question, "___") || len(q.Accepted) == 0 {
				continue
			}
			q.Options, q.Answer = []string{}, -1
		default:
			continue
		}
		qs = append(qs, q)
	}
	out.Questions = capped(qs, r.Sections.Listening)
	if len(out.Segments) == 0 {
		return nil, u, fmt.Errorf("listening script is empty")
	}
	return &out, u, nil
}

func (c *Client) GrammarWriting(ctx context.Context, m Model, r GrammarRequest) ([]WritingTask, *Usage, error) {
	prompt := grammarIntro(r) + fmt.Sprintf(
		"Write exactly %d English sentences for the learner to translate into German. Each translation must require the grammar point. "+
			"Keep the English natural and unambiguous.",
		r.Sections.Writing)
	var out struct{ Items []WritingTask }
	u, err := c.chatJSONWith(ctx, c.slow, m, grammarSystem, prompt, "grammar_writing", writingSchema, 0.7, &out)
	if err != nil {
		return nil, u, err
	}
	var items []WritingTask
	for _, it := range out.Items {
		if strings.TrimSpace(it.English) != "" && strings.TrimSpace(it.German) != "" {
			items = append(items, it)
		}
	}
	return capped(items, r.Sections.Writing), u, nil
}

func cleanChoices(qs []ChoiceQuestion, n int) []ChoiceQuestion {
	var out []ChoiceQuestion
	for _, q := range qs {
		if strings.TrimSpace(q.Question) != "" && len(q.Options) >= 2 && q.Answer >= 0 && q.Answer < len(q.Options) {
			out = append(out, q)
		}
	}
	return capped(out, n)
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

var writingFeedbackSchema = obj(map[string]any{
	"items": arr(obj(map[string]any{
		"score":     integer("0-10: 10 fully correct and natural, 7-9 small slips (spelling, a missing comma), 4-6 one real grammar error, 0-3 wrong or missing"),
		"verdict":   map[string]any{"type": "string", "enum": []string{"correct", "minor", "wrong"}},
		"corrected": str("The learner's sentence with the fewest changes that make it correct; the answer itself if already correct"),
		"feedback":  str("1-2 sentences in Vietnamese: what is wrong and why, focusing on the grammar point; praise briefly if correct"),
	})),
})

// GradeWriting marks the learner's German translations, one result per answer.
func (c *Client) GradeWriting(ctx context.Context, m Model, grammar, level string, answers []WritingAnswer) ([]WritingFeedback, *Usage, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Grade a CEFR %s learner's English → German translations. Grammar point being practised: %s\n", level, grammar)
	b.WriteString("Accept any correct, natural translation, not only the reference. Empty answers score 0. Return exactly one result per item, in order.\n\n")
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
