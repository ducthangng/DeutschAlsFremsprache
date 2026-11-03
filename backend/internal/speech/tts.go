package speech

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// TTSModel names Azure neural speech in the shared tts_audio cache.
const TTSModel = "azure-neural"

// ttsBitrate matches ttsFormat; used to derive the clip length.
const (
	ttsFormat  = "audio-24khz-48kbitrate-mono-mp3"
	ttsBitrate = 48_000
)

// German neural voices, handed out to speakers in order.
var germanVoices = map[string][]string{
	"female": {"de-DE-KatjaNeural", "de-DE-AmalaNeural", "de-DE-LouisaNeural"},
	"male":   {"de-DE-ConradNeural", "de-DE-KillianNeural", "de-DE-BerndNeural"},
}

// Line is one stretch of speech by one speaker.
type Line struct {
	Gender string // female | male
	Voice  int    // n-th speaker of that gender
	Text   string
}

// SSML builds the document Azure renders: each line in its speaker's voice,
// a short pause between lines, slightly slower than normal for learners.
func SSML(lang string, lines []Line) string {
	var b strings.Builder
	fmt.Fprintf(&b, `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="%s">`, lang)
	for _, l := range lines {
		voices := germanVoices[l.Gender]
		if voices == nil {
			voices = germanVoices["female"]
		}
		fmt.Fprintf(&b, `<voice name="%s"><prosody rate="-8%%">`, voices[l.Voice%len(voices)])
		xml.EscapeText(&b, []byte(l.Text))
		b.WriteString(`</prosody><break time="500ms"/></voice>`)
	}
	b.WriteString(`</speak>`)
	return b.String()
}

// Synthesis is an MP3 rendered by Azure.
type Synthesis struct {
	MP3        []byte
	DurationMs int
}

// Synthesize renders SSML with Azure neural text-to-speech.
func (c *Client) Synthesize(ctx context.Context, ssml string) (*Synthesis, error) {
	u := fmt.Sprintf("https://%s.tts.speech.microsoft.com/cognitiveservices/v1", c.region)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(ssml))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", c.key)
	req.Header.Set("Content-Type", "application/ssml+xml")
	req.Header.Set("X-Microsoft-OutputFormat", ttsFormat)
	req.Header.Set("User-Agent", "deutschfremsprache")
	resp, err := (&http.Client{Timeout: 3 * time.Minute}).Do(req) // a few minutes of audio takes a while
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("azure tts: %d %s", resp.StatusCode, strings.TrimSpace(buf.String()))
	}
	if buf.Len() == 0 {
		return nil, fmt.Errorf("azure tts returned empty audio")
	}
	return &Synthesis{MP3: buf.Bytes(), DurationMs: buf.Len() * 8 * 1000 / ttsBitrate}, nil
}
