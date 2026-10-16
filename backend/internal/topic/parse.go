// Package topic turns the raw text a user types into practice lines.
//
// Format, one line per sentence:
//
//	vocabulary:  der Hund | con chó
//	dialogue:    Anna: Wo ist der Bahnhof? | Nhà ga ở đâu?
//
// The part after " | " is an optional note/translation. In dialogue topics the
// "Speaker:" prefix is optional; lines without it inherit no speaker.
package topic

import (
	"strings"
	"unicode/utf8"
)

const (
	KindVocabulary = "vocabulary"
	KindDialogue   = "dialogue"
)

var Languages = map[string]bool{"de-DE": true, "en-US": true}

type Line struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
	Note    string `json:"note"`
	// ImageKey is an optional picture for the line; it is not part of the text format.
	ImageKey string `json:"-"`
}

const maxSpeakerLen = 24

func Parse(kind, content string) []Line {
	var out []Line
	for _, raw := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		raw = strings.TrimSpace(raw)
		if raw == "" || strings.HasPrefix(raw, "#") {
			continue
		}
		var l Line
		if text, note, ok := strings.Cut(raw, "|"); ok {
			raw, l.Note = strings.TrimSpace(text), strings.TrimSpace(note)
		}
		if kind == KindDialogue {
			if sp, text, ok := strings.Cut(raw+" ", ": "); ok {
				sp = strings.TrimSpace(sp)
				if sp != "" && utf8.RuneCountInString(sp) <= maxSpeakerLen && !strings.ContainsAny(sp, ".?!,") {
					l.Speaker, raw = sp, strings.TrimSpace(text)
				}
			}
		}
		l.Text = raw
		if l.Text != "" {
			out = append(out, l)
		}
	}
	return out
}

// Format is the inverse of Parse, used to show the editable source of a topic.
func Format(lines []Line) string {
	var b strings.Builder
	for _, l := range lines {
		if l.Speaker != "" {
			b.WriteString(l.Speaker + ": ")
		}
		b.WriteString(l.Text)
		if l.Note != "" {
			b.WriteString(" | " + l.Note)
		}
		b.WriteByte('\n')
	}
	return b.String()
}
