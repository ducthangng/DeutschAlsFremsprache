// Package speech wraps Azure Pronunciation Assessment, which scores the
// learner's recording. (Reference audio is spoken by the browser.)
package speech

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	key, region string
	http        *http.Client
}

func New(key, region string) *Client {
	return &Client{key: key, region: region, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) Enabled() bool { return c.key != "" && c.region != "" }

// Scores is the sentence-level part of an assessment.
type Scores struct {
	PronScore         float64 `json:"pronScore"`
	AccuracyScore     float64 `json:"accuracyScore"`
	FluencyScore      float64 `json:"fluencyScore"`
	CompletenessScore float64 `json:"completenessScore"`
}

// RecognizedWord is one word as returned by Azure.
type RecognizedWord struct {
	Word          string
	AccuracyScore float64
	ErrorType     string // None, Omission, Insertion, Mispronunciation, ...
}

type Assessment struct {
	Scores
	Recognized string
	Words      []RecognizedWord
}

// Assess runs Pronunciation Assessment on 16 kHz mono 16-bit PCM WAV audio.
func (c *Client) Assess(ctx context.Context, lang, reference string, wav []byte) (*Assessment, error) {
	params, _ := json.Marshal(map[string]any{
		"ReferenceText": reference,
		"GradingSystem": "HundredMark",
		"Granularity":   "Phoneme",
		"Dimension":     "Comprehensive",
		"EnableMiscue":  true,
	})
	u := fmt.Sprintf("https://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?%s",
		c.region, url.Values{"language": {lang}, "format": {"detailed"}}.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(wav))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", c.key)
	req.Header.Set("Content-Type", "audio/wav; codecs=audio/pcm; samplerate=16000")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Pronunciation-Assessment", base64.StdEncoding.EncodeToString(params))
	raw, err := c.do(req)
	if err != nil {
		return nil, err
	}
	return parseAssessment(raw)
}

// Transcribe converts free speech (16 kHz WAV) to text with Azure
// speech-to-text. Used when there is no reference text to assess against.
func (c *Client) Transcribe(ctx context.Context, lang string, wav []byte) (string, error) {
	u := fmt.Sprintf("https://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?%s",
		c.region, url.Values{"language": {lang}, "format": {"detailed"}}.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(wav))
	if err != nil {
		return "", err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", c.key)
	req.Header.Set("Content-Type", "audio/wav; codecs=audio/pcm; samplerate=16000")
	req.Header.Set("Accept", "application/json")
	raw, err := c.do(req)
	if err != nil {
		return "", err
	}
	var r azureResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return "", fmt.Errorf("decode azure response: %w", err)
	}
	if r.RecognitionStatus != "Success" {
		return "", nil // silence / nothing recognized
	}
	if r.DisplayText != "" {
		return r.DisplayText, nil
	}
	if len(r.NBest) > 0 {
		return r.NBest[0].Display, nil
	}
	return "", nil
}

// paScores covers both response shapes Azure uses: scores directly on the
// object, or nested under "PronunciationAssessment".
type paScores struct {
	AccuracyScore     float64
	FluencyScore      float64
	CompletenessScore float64
	PronScore         float64
	ErrorType         string
}

type azureResponse struct {
	RecognitionStatus string
	DisplayText       string
	NBest             []struct {
		Display string
		paScores
		PronunciationAssessment *paScores
		Words                   []struct {
			Word string
			paScores
			PronunciationAssessment *paScores
		}
	}
}

func parseAssessment(raw []byte) (*Assessment, error) {
	var r azureResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("decode azure response: %w", err)
	}
	a := &Assessment{}
	if r.RecognitionStatus != "Success" || len(r.NBest) == 0 {
		// NoMatch / InitialSilenceTimeout: nothing recognized, everything omitted.
		return a, nil
	}
	best := r.NBest[0]
	s := best.paScores
	if best.PronunciationAssessment != nil {
		s = *best.PronunciationAssessment
	}
	a.Scores = Scores{PronScore: s.PronScore, AccuracyScore: s.AccuracyScore, FluencyScore: s.FluencyScore, CompletenessScore: s.CompletenessScore}
	a.Recognized = r.DisplayText
	for _, w := range best.Words {
		ws := w.paScores
		if w.PronunciationAssessment != nil {
			ws = *w.PronunciationAssessment
		}
		a.Words = append(a.Words, RecognizedWord{Word: w.Word, AccuracyScore: ws.AccuracyScore, ErrorType: ws.ErrorType})
	}
	return a, nil
}

func (c *Client) do(req *http.Request) ([]byte, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("azure %s: %d %s", req.URL.Host, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return b, nil
}
