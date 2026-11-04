package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode"
)

type voiceInfo struct {
	Name   string
	Gender string // female | male | neutral
	Desc   string
}

// voiceCatalog describes the TTS voices so the casting call can match them to
// a topic's mood and speakers. Within a gender, the order is the fallback
// preference.
var voiceCatalog = []voiceInfo{
	{"coral", "female", "warm, friendly, bright, smiling"},
	{"nova", "female", "young, energetic, upbeat"},
	{"shimmer", "female", "clear, light, gentle"},
	{"sage", "female", "calm, soft, thoughtful"},
	{"ash", "male", "clear, confident, friendly"},
	{"verse", "male", "lively, expressive, versatile"},
	{"fable", "male", "animated storyteller, playful"},
	{"echo", "male", "calm, steady, even"},
	{"onyx", "male", "deep, low, serious, authoritative"},
	{"ballad", "male", "soft, emotional, melancholic"},
	{"alloy", "neutral", "balanced, matter-of-fact"},
}

func voiceGender(v string) string {
	if i := slices.IndexFunc(voiceCatalog, func(c voiceInfo) bool { return c.Name == v }); i >= 0 {
		return voiceCatalog[i].Gender
	}
	return ""
}

// titleGender reads the gender off a form of address in the speaker name
// (Herr Weber, Frau Keller, Mr Smith): no guessing needed.
func titleGender(speaker string) string {
	words := strings.Fields(speaker)
	if len(words) == 0 {
		return ""
	}
	switch strings.ToLower(strings.Trim(words[0], ".,:")) {
	case "herr", "mr", "mister", "sir", "opa", "onkel", "vater", "papa", "großvater", "grandpa", "uncle", "dad", "father":
		return "male"
	case "frau", "fräulein", "mrs", "ms", "miss", "madam", "oma", "tante", "mutter", "mama", "großmutter", "grandma", "aunt", "mom", "mum", "mother":
		return "female"
	}
	return ""
}

// defaultVoice is the voice of the n-th speaker without a cast: the gender of
// a titled name is respected, otherwise voices alternate by speaker order.
func defaultVoice(speaker string, n int) string {
	if g := titleGender(speaker); g != "" && voiceGender(VoiceFor(n)) != g {
		return pickVoice(g, nil)
	}
	return VoiceFor(n)
}

// pickVoice returns the first voice of the gender not in used (any voice of
// the gender when all are taken).
func pickVoice(gender string, used map[string]bool) string {
	var first string
	for _, v := range voiceCatalog {
		if gender != "" && v.Gender != gender {
			continue
		}
		if first == "" {
			first = v.Name
		}
		if !used[v.Name] {
			return v.Name
		}
	}
	return first
}

// castVersion changes when casting gets better, so older casts are redone.
// 2: speakers have an explicit gender that the voice must match.
const castVersion = 2

// CastMember is the voice of one speaker ("" = narrator of a vocabulary topic).
type CastMember struct {
	Speaker   string `json:"speaker"`
	Gender    string `json:"gender"` // female | male | unknown
	Voice     string `json:"voice"`
	Character string `json:"character"` // how this speaker sounds, for the TTS instructions
}

// VoiceCast is how a topic is read aloud: one mood for the whole topic and a
// fitting voice per speaker. It is chosen once per topic.
type VoiceCast struct {
	Version  int          `json:"v"`
	Tone     string       `json:"tone"`   // English, for the TTS instructions
	ToneVi   string       `json:"toneVi"` // short Vietnamese label for the UI
	Speakers []CastMember `json:"speakers"`
}

// Current reports whether the cast was made by the current casting rules.
func (vc *VoiceCast) Current() bool { return vc != nil && vc.Version == castVersion }

// For returns the voice and the style instructions of a speaker; n is the
// speaker's position, used when the cast does not know them.
func (vc *VoiceCast) For(speaker string, n int) (voice, style string) {
	if vc == nil {
		return defaultVoice(speaker, n), ""
	}
	voice = defaultVoice(speaker, n)
	style = "Mood of the whole text: " + vc.Tone + "."
	for _, m := range vc.Speakers {
		if m.Speaker == speaker {
			voice = m.Voice
			if m.Character != "" {
				style += " You are: " + m.Character + "."
			}
			break
		}
	}
	return voice, style
}

// Property names sort into the order the model fills them in: evidence,
// then gender, then persona, then the voice.
var castSchema = obj(map[string]any{
	"tone":   str("The emotional tone of the whole text in English, a few adjectives, e.g. \"cheerful, playful, upbeat\""),
	"toneVi": str("The same tone as a short Vietnamese label, e.g. \"vui vẻ, hào hứng\""),
	"speakers": arr(obj(map[string]any{
		"speaker": str("The speaker name exactly as given"),
		"clue":    str("The evidence for the speaker's gender, quoted from the text: the name, a title (Herr/Frau), a gendered role noun (Kellnerin/Kellner), how others address them, or \"none\""),
		"gender":  map[string]any{"type": "string", "enum": []string{"female", "male", "unknown"}, "description": "The speaker's gender from the clue"},
		"persona": str("How this speaker sounds, in English, one short phrase that matches the gender: age, gender, mood, e.g. \"a cheerful young waitress\""),
		"voice":   str("One voice name from the catalog whose gender equals the speaker's gender"),
	})),
})

// CastVoices picks the tone and a voice per speaker that fit the topic. The
// sample is the start of the text; speakers lists every speaker in order
// ("" = narrator). The result has one member per speaker, in order.
func (c *Client) CastVoices(ctx context.Context, language, title, description string, speakers, sample []string) (*VoiceCast, *Usage, error) {
	var catalog strings.Builder
	for _, v := range voiceCatalog {
		fmt.Fprintf(&catalog, "- %s (%s): %s\n", v.Name, v.Gender, v.Desc)
	}
	in, _ := json.Marshal(speakers)
	prompt := "Cast the text-to-speech voices for a language-learning text (" + language + ").\n" +
		"Title: " + title + "\nDescription: " + description + "\nText:\n" + strings.Join(sample, "\n") + "\n\n" +
		"1. Decide the emotional tone of the text from its content. A fun, happy or casual topic must sound cheerful and lively; " +
		"only a sad or serious topic may sound low or serious. A plain word list sounds friendly and clear.\n" +
		"2. For every speaker decide the gender first, from evidence: the first name (Anna, Lena, Sophie = female; Max, Tom, Lukas = male), " +
		"a title (Herr = male, Frau = female), a gendered role noun (Kellnerin, Verkäuferin, Ärztin = female; Kellner, Verkäufer, Arzt = male), " +
		"or how the other speakers address or describe them. A masculine role noun with no other evidence (Patient, Kunde, Gast) counts as male. Use \"unknown\" only when there is no evidence at all (e.g. speakers called A and B).\n" +
		"3. Then pick a voice whose gender equals the speaker's gender (any gender for unknown) and whose description fits the speaker and the tone. " +
		"A man never gets a female voice and a woman never gets a male voice. " +
		"Avoid melancholic or deep serious voices (ballad, onyx) unless the text is sad or serious. " +
		"Different speakers get different voices. The speaker \"\" is the narrator (gender unknown unless the text says otherwise).\n" +
		"Voice catalog:\n" + catalog.String() +
		fmt.Sprintf("Return exactly %d speakers, in this order (JSON): %s", len(speakers), in)
	var out struct {
		Tone, ToneVi string
		Speakers     []struct{ Speaker, Gender, Persona, Voice string }
	}
	u, err := c.chatJSON(ctx, "You are the casting director of an audio course.", prompt, "voice_cast", castSchema, 0, &out)
	if err != nil {
		return nil, u, err
	}
	vc := &VoiceCast{Version: castVersion, Tone: strings.TrimSpace(out.Tone), ToneVi: strings.TrimSpace(out.ToneVi)}
	// The model sometimes garbles Vietnamese diacritics into NUL bytes: show no label rather than a broken one.
	if strings.ContainsFunc(vc.ToneVi, unicode.IsControl) {
		vc.ToneVi = ""
	}
	if vc.Tone == "" || strings.ContainsFunc(vc.Tone, unicode.IsControl) {
		return nil, u, fmt.Errorf("voice cast without tone")
	}
	// One member per speaker, matched by name, else by position.
	used := map[string]bool{}
	for i, sp := range speakers {
		j := slices.IndexFunc(out.Speakers, func(m struct{ Speaker, Gender, Persona, Voice string }) bool {
			return strings.TrimSpace(strings.TrimSuffix(m.Speaker, ":")) == sp
		})
		if j < 0 && i < len(out.Speakers) && len(out.Speakers) == len(speakers) {
			j = i
		}
		m := CastMember{Speaker: sp, Gender: "unknown"}
		if j >= 0 {
			m.Gender, m.Voice, m.Character = out.Speakers[j].Gender, out.Speakers[j].Voice, strings.TrimSpace(out.Speakers[j].Persona)
		}
		if g := titleGender(sp); g != "" && g != m.Gender {
			m.Gender, m.Character = g, "" // the persona described the wrong person
		}
		if m.Gender != "female" && m.Gender != "male" {
			m.Gender = "unknown"
		}
		// The voice must exist, match the gender and not be taken by another speaker.
		if g := voiceGender(m.Voice); g == "" || used[m.Voice] || (m.Gender != "unknown" && g != m.Gender) {
			want := m.Gender
			if want == "unknown" {
				want = []string{"female", "male"}[i%2] // A and B: still clearly two people
			}
			m.Voice = pickVoice(want, used)
		}
		used[m.Voice] = true
		vc.Speakers = append(vc.Speakers, m)
	}
	return vc, u, nil
}
