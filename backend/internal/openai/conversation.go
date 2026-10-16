package openai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// chatJSON runs one chat completion constrained to a JSON schema and decodes
// the answer into out. Usage is returned even when decoding fails (tokens are
// billed either way).
func (c *Client) chatJSON(ctx context.Context, system, user, schemaName string, schema map[string]any, temperature float64, out any) (*Usage, error) {
	body := map[string]any{
		"model": c.cfg.ChatModel,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
		"response_format": map[string]any{
			"type":        "json_schema",
			"json_schema": map[string]any{"name": schemaName, "strict": true, "schema": schema},
		},
	}
	if !strings.HasPrefix(c.cfg.ChatModel, "gpt-5") && !strings.HasPrefix(c.cfg.ChatModel, "o") {
		body["temperature"] = temperature
	}
	raw, err := c.post(ctx, "/chat/completions", body)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Choices []struct {
			Message struct {
				Content string
				Refusal string
			}
			FinishReason string `json:"finish_reason"`
		}
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		}
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("decode openai response: %w", err)
	}
	u := &Usage{Model: c.cfg.ChatModel, InputTokens: resp.Usage.PromptTokens, OutputTokens: resp.Usage.CompletionTokens}
	u.CostUSD = float64(u.InputTokens)/1e6*c.cfg.ChatUSDPerMInput + float64(u.OutputTokens)/1e6*c.cfg.ChatUSDPerMOutput
	switch {
	case len(resp.Choices) == 0:
		return u, errors.New("openai returned no choices")
	case resp.Choices[0].Message.Refusal != "":
		return u, fmt.Errorf("openai refused: %s", resp.Choices[0].Message.Refusal)
	case resp.Choices[0].FinishReason == "length":
		return u, errors.New("openai response was cut off")
	}
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), out); err != nil {
		return u, fmt.Errorf("decode %s: %w", schemaName, err)
	}
	return u, nil
}

// obj builds a strict JSON-schema object where every property is required.
func obj(props map[string]any) map[string]any {
	req := make([]string, 0, len(props))
	for k := range props {
		req = append(req, k)
	}
	return map[string]any{"type": "object", "additionalProperties": false, "required": req, "properties": props}
}

func str(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }

func num(desc string) map[string]any { return map[string]any{"type": "number", "description": desc} }

func arr(items map[string]any) map[string]any { return map[string]any{"type": "array", "items": items} }

var langName = map[string]string{"de-DE": "German", "en-US": "American English"}

// ---- simulation ----

type Scenario struct {
	Title       string `json:"title"`     // short, Vietnamese
	Setting     string `json:"setting"`   // where/when, Vietnamese
	Partner     string `json:"partner"`   // AI character's name and role, e.g. "Frau Keller, Vermieterin"
	UserRole    string `json:"userRole"`  // who the learner plays, Vietnamese
	Goal        string `json:"goal"`      // what the learner must achieve, Vietnamese
	Opening     string `json:"opening"`   // the partner's first line, target language
	OpeningVi   string `json:"openingVi"` // its Vietnamese translation
	Twist       string `json:"twist"`     // a complication the partner introduces later (hidden from the UI)
	UsefulWords []struct {
		Term    string `json:"term"`
		Meaning string `json:"meaning"`
	} `json:"usefulWords"`
}

type ScenarioRequest struct {
	Language   string
	Level      string
	Hint       string   // optional theme from the learner
	Topics     []string // recently practiced topics
	Vocabulary []string // words from the learner's pocket
	Avoid      []string // titles of recent simulations, for variety
}

var scenarioSchema = obj(map[string]any{
	"title": str("Short title in Vietnamese"), "setting": str("Where and when, 1-2 sentences in Vietnamese"),
	"partner": str("The AI character: name and role, in the target language"), "userRole": str("The learner's role, Vietnamese"),
	"goal": str("What the learner must achieve in the conversation, Vietnamese"), "opening": str("The character's first line, target language"),
	"openingVi": str("Vietnamese translation of opening"), "twist": str("A realistic complication the character will introduce mid-conversation"),
	"usefulWords": arr(obj(map[string]any{"term": str("Useful word or phrase, target language"), "meaning": str("Vietnamese meaning")})),
})

// GenerateScenario invents a fresh role-play situation tailored to the learner.
func (c *Client) GenerateScenario(ctx context.Context, r ScenarioRequest) (*Scenario, *Usage, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Create an improvised speaking role-play in %s for a Vietnamese learner at CEFR level %s.\n", langName[r.Language], r.Level)
	if r.Hint != "" {
		fmt.Fprintf(&b, "The learner asked for this theme: %s\n", r.Hint)
	}
	if len(r.Topics) > 0 {
		fmt.Fprintf(&b, "Situations the learner has practiced (build on them, but invent a NEW situation): %s\n", strings.Join(r.Topics, "; "))
	}
	if len(r.Vocabulary) > 0 {
		fmt.Fprintf(&b, "Words the learner is studying (make the situation one where some of them are useful): %s\n", strings.Join(r.Vocabulary, ", "))
	}
	if len(r.Avoid) > 0 {
		fmt.Fprintf(&b, "Do not repeat these recent simulations: %s\n", strings.Join(r.Avoid, "; "))
	}
	b.WriteString("The situation must be realistic everyday life (e.g. in Germany for German), require the learner to explain, ask, negotiate or solve a problem, " +
		"and be completable in about 10 exchanges. The character speaks naturally for the level. Give 5-8 useful words.")
	var s Scenario
	u, err := c.chatJSON(ctx, "You design realistic conversation role-plays for language learners.", b.String(), "scenario", scenarioSchema, 1.0, &s)
	return &s, u, err
}

// Message is one line of a simulation transcript.
type Message struct {
	Speaker string // "ai" or "user"
	Text    string
}

type TurnEvaluation struct {
	LogicScore  float64 `json:"logicScore"`  // 0-100: relevant, coherent, moves the conversation forward
	Understood  bool    `json:"understood"`  // would a native speaker understand it
	Feedback    string  `json:"feedback"`    // short, encouraging, Vietnamese
	Corrected   string  `json:"corrected"`   // natural, correct version of what the learner meant
	GrammarNote string  `json:"grammarNote"` // main grammar/word issue in Vietnamese, "" if none
	Reply       string  `json:"reply"`       // the character's next line, target language
	ReplyVi     string  `json:"replyVi"`     // Vietnamese translation
	End         bool    `json:"end"`         // the conversation reached a natural end
}

var evaluationSchema = obj(map[string]any{
	"logicScore":  num("0-100. How logical, relevant and appropriate the learner's message is in this situation (not pronunciation)"),
	"understood":  map[string]any{"type": "boolean"},
	"feedback":    str("1-2 short, encouraging sentences in Vietnamese about content and language"),
	"corrected":   str("A natural, grammatically correct version of what the learner tried to say, at their level, target language"),
	"grammarNote": str("The single most useful grammar or vocabulary correction, in Vietnamese; empty string if none"),
	"reply":       str("The character's next line in the target language, staying in role, 1-3 sentences"),
	"replyVi":     str("Vietnamese translation of reply"),
	"end":         map[string]any{"type": "boolean", "description": "True only if the goal is reached or the conversation is naturally over"},
})

func transcript(msgs []Message, partner string) string {
	var b strings.Builder
	for _, m := range msgs {
		who := "Learner"
		if m.Speaker == "ai" {
			who = partner
		}
		fmt.Fprintf(&b, "%s: %s\n", who, m.Text)
	}
	return b.String()
}

// EvaluateTurn judges the learner's latest message and continues the role-play.
func (c *Client) EvaluateTurn(ctx context.Context, language, level string, sc *Scenario, history []Message, said string, round, maxRounds int) (*TurnEvaluation, *Usage, error) {
	system := fmt.Sprintf("You play %s in a %s role-play with a Vietnamese learner (CEFR %s), and you also evaluate the learner. "+
		"Setting: %s. Learner's role: %s. Learner's goal: %s. Planned complication (introduce it around the middle if natural): %s. "+
		"Stay in character, keep replies short and natural for the level, and react to what the learner actually said. "+
		"If the message is off-topic or illogical, react in character with mild confusion and help them back. "+
		"The learner's text is a speech-recognition transcript: ignore punctuation and capitalization, judge meaning and wording.",
		sc.Partner, langName[language], level, sc.Setting, sc.UserRole, sc.Goal, sc.Twist)
	user := fmt.Sprintf("Conversation so far:\n%s\nLearner's new message (round %d of %d): %s\n", transcript(history, sc.Partner), round, maxRounds, said)
	if round >= maxRounds {
		user += "This is the last round: let the character wrap up the conversation politely.\n"
	}
	var e TurnEvaluation
	u, err := c.chatJSON(ctx, system, user, "turn_evaluation", evaluationSchema, 0.7, &e)
	return &e, u, err
}

type Summary struct {
	Overall       float64  `json:"overall"` // 0-100
	GoalReached   bool     `json:"goalReached"`
	CEFR          string   `json:"cefr"`         // estimated level shown in this conversation
	Strengths     []string `json:"strengths"`    // Vietnamese
	Improvements  []string `json:"improvements"` // Vietnamese
	UsefulPhrases []struct {
		Phrase  string `json:"phrase"`
		Meaning string `json:"meaning"`
	} `json:"usefulPhrases"`
	Verdict string `json:"verdict"` // one encouraging sentence, Vietnamese
}

var summarySchema = obj(map[string]any{
	"overall": num("0-100 overall communication score"), "goalReached": map[string]any{"type": "boolean"},
	"cefr": str("Estimated CEFR level shown, e.g. A2"), "strengths": arr(str("Vietnamese")), "improvements": arr(str("Vietnamese, concrete")),
	"usefulPhrases": arr(obj(map[string]any{"phrase": str("target language phrase the learner should learn from this situation"), "meaning": str("Vietnamese")})),
	"verdict":       str("One encouraging sentence in Vietnamese"),
})

// Summarize evaluates a finished simulation as a whole.
func (c *Client) Summarize(ctx context.Context, language, level string, sc *Scenario, history []Message, avgPron float64) (*Summary, *Usage, error) {
	user := fmt.Sprintf("Role-play in %s, learner level %s. Learner's goal: %s\nAverage pronunciation score: %.0f/100.\n\nTranscript:\n%s\n"+
		"Evaluate the learner: 2-4 strengths, 2-4 concrete improvements, 3-5 useful phrases for this situation.",
		langName[language], level, sc.Goal, avgPron, transcript(history, sc.Partner))
	var s Summary
	u, err := c.chatJSON(ctx, "You are a supportive, precise speaking coach for Vietnamese learners.", user, "simulation_summary", summarySchema, 0.4, &s)
	return &s, u, err
}

// ---- images ----

type ImageResult struct {
	PNG     []byte
	Model   string
	CostUSD float64
}

// GenerateImage draws a simple illustration for a flashcard.
func (c *Client) GenerateImage(ctx context.Context, model string, costUSD float64, term, meaning, language string) (*ImageResult, error) {
	prompt := fmt.Sprintf("A simple, friendly flat illustration that clearly shows the meaning of the %s word or phrase \"%s\" (Vietnamese: %s). "+
		"Soft muted colors on a dark background, one clear subject, no text, no letters, no captions.", langName[language], term, meaning)
	body := map[string]any{"model": model, "prompt": prompt, "n": 1, "size": "1024x1024"}
	if strings.HasPrefix(model, "gpt-image") {
		body["quality"] = "low"
	} else {
		body["response_format"] = "b64_json"
	}
	raw, err := c.post(ctx, "/images/generations", body)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			B64 string `json:"b64_json"`
		}
	}
	if err := json.Unmarshal(raw, &resp); err != nil || len(resp.Data) == 0 {
		return nil, fmt.Errorf("decode image response: %v", err)
	}
	png, err := base64.StdEncoding.DecodeString(resp.Data[0].B64)
	if err != nil {
		return nil, err
	}
	return &ImageResult{PNG: png, Model: model, CostUSD: costUSD}, nil
}
