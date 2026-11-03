package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// GermanTerm is a word a learner saves, with the sentence it came from.
type GermanTerm struct {
	Term    string `json:"term"`
	Context string `json:"context"`
}

var germanTermsSchema = obj(map[string]any{
	"items": arr(obj(map[string]any{
		"term": str("The term in its card form, following the rules"),
	})),
})

const germanTermsSystem = "You are a German lexicographer preparing flashcards for Vietnamese learners of German. " +
	"You rewrite each saved term into its card form and never translate it."

// GermanCardForms rewrites German terms into the form a flashcard needs:
// nouns with their article (die Zeitung), finite verbs with their subject
// (liest (du)). Everything else comes back unchanged. The result has one
// entry per input term, in order.
func (c *Client) GermanCardForms(ctx context.Context, terms []GermanTerm) ([]string, *Usage, error) {
	in, _ := json.Marshal(terms)
	prompt := "Rewrite each term into its flashcard form. Use the context sentence (may be empty) to decide part of speech, gender and subject.\n" +
		"Rules:\n" +
		"- Noun: definite article + nominative singular, capitalized: Zeitung, Zeitungen, der Zeitung → \"die Zeitung\". " +
		"Plural-only nouns: \"die Leute (Pl.)\". Nouns that already have the right article stay as they are.\n" +
		"- Finite (conjugated) verb: keep the form exactly as given and add its grammatical person in parentheses, chosen from the context. " +
		"Write the person as one of: ich, du, er/sie/es, wir, ihr, sie/Sie (third person singular is always \"er/sie/es\", even when the subject is a noun or \"sie\"): " +
		"liest → \"liest (du)\" or \"liest (er/sie/es)\"; gehe → \"gehe (ich)\". Without context list every possible person: \"liest (du, er/sie/es)\". " +
		"If the context shows a separable prefix at the end of the clause, add it after the verb: \"steigt\" in \"Sie steigt in Köln um.\" → \"steigt um (er/sie/es)\". " +
		"A term that already has a person stays as it is.\n" +
		"- A form identical to the infinitive (gehen, lesen) is an infinitive and stays unchanged, unless the context clearly uses it as a finite verb with wir or sie/Sie: \"gehen (wir)\".\n" +
		"- Participles, adjectives, adverbs, other words and multi-word phrases: unchanged.\n" +
		"- Never translate, never add explanations, never change spelling.\n" +
		fmt.Sprintf("Return exactly %d items in the same order.\nTerms (JSON): %s", len(terms), in)
	var out struct {
		Items []struct{ Term string }
	}
	u, err := c.chatJSON(ctx, germanTermsSystem, prompt, "german_card_forms", germanTermsSchema, 0, &out)
	if err != nil {
		return nil, u, err
	}
	if len(out.Items) != len(terms) {
		return nil, u, fmt.Errorf("got %d card forms for %d terms", len(out.Items), len(terms))
	}
	forms := make([]string, len(terms))
	for i, it := range out.Items {
		forms[i] = strings.TrimSpace(it.Term)
		if forms[i] == "" || len([]rune(forms[i])) > 200 {
			forms[i] = terms[i].Term
		}
	}
	return forms, u, nil
}
