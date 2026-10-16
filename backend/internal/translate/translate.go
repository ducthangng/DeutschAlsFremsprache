// Package translate provides machine translation for sentence meanings and
// word look-ups. Azure Translator is used when a key is configured; otherwise
// the free MyMemory API (no key, daily quota) is used.
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

type Translator interface {
	// Translate translates texts from one language code ("de", "en") to another ("vi").
	// The result has the same length and order as texts.
	Translate(ctx context.Context, from, to string, texts []string) ([]string, error)
	Name() string
	// CostUSD estimates the price of translating the given characters.
	CostUSD(chars int) float64
}

var httpClient = &http.Client{Timeout: 20 * time.Second}

// ---- Azure Translator ----

type Azure struct {
	Key, Region        string
	USDPerMillionChars float64
}

func (a *Azure) Name() string { return "azure" }

func (a *Azure) CostUSD(chars int) float64 { return float64(chars) / 1e6 * a.USDPerMillionChars }

// Azure accepts up to 1000 texts / 50,000 characters per request.
const azureBatchChars = 45000

func (a *Azure) Translate(ctx context.Context, from, to string, texts []string) ([]string, error) {
	out := make([]string, 0, len(texts))
	for start := 0; start < len(texts); {
		end, size := start, 0
		for end < len(texts) && end-start < 1000 && (end == start || size+len(texts[end]) <= azureBatchChars) {
			size += len(texts[end])
			end++
		}
		part, err := a.batch(ctx, from, to, texts[start:end])
		if err != nil {
			return nil, err
		}
		out = append(out, part...)
		start = end
	}
	return out, nil
}

func (a *Azure) batch(ctx context.Context, from, to string, texts []string) ([]string, error) {
	body := make([]map[string]string, len(texts))
	for i, t := range texts {
		body[i] = map[string]string{"Text": t}
	}
	b, _ := json.Marshal(body)
	u := "https://api.cognitive.microsofttranslator.com/translate?" + url.Values{"api-version": {"3.0"}, "from": {from}, "to": {to}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", a.Key)
	if a.Region != "" {
		req.Header.Set("Ocp-Apim-Subscription-Region", a.Region)
	}
	req.Header.Set("Content-Type", "application/json")
	raw, err := do(req)
	if err != nil {
		return nil, err
	}
	var resp []struct {
		Translations []struct{ Text string } `json:"translations"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, err
	}
	if len(resp) != len(texts) {
		return nil, fmt.Errorf("azure translator: got %d results for %d texts", len(resp), len(texts))
	}
	out := make([]string, len(resp))
	for i, r := range resp {
		if len(r.Translations) > 0 {
			out[i] = r.Translations[0].Text
		}
	}
	return out, nil
}

// ---- MyMemory (free) ----

type MyMemory struct {
	Email string // optional; raises the anonymous daily quota
}

func (m *MyMemory) Name() string { return "mymemory" }

func (m *MyMemory) CostUSD(int) float64 { return 0 }

// MyMemory rejects queries longer than 500 bytes.
const myMemoryMaxBytes = 500

func (m *MyMemory) Translate(ctx context.Context, from, to string, texts []string) ([]string, error) {
	out := make([]string, len(texts))
	for i, t := range texts {
		if len(t) > myMemoryMaxBytes {
			t = truncateUTF8(t, myMemoryMaxBytes)
		}
		v := url.Values{"q": {t}, "langpair": {from + "|" + to}}
		if m.Email != "" {
			v.Set("de", m.Email)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.mymemory.translated.net/get?"+v.Encode(), nil)
		if err != nil {
			return nil, err
		}
		raw, err := do(req)
		if err != nil {
			return nil, err
		}
		var resp struct {
			ResponseData struct {
				TranslatedText string `json:"translatedText"`
			} `json:"responseData"`
			ResponseStatus  any    `json:"responseStatus"` // number or string
			ResponseDetails string `json:"responseDetails"`
		}
		if err := json.Unmarshal(raw, &resp); err != nil {
			return nil, err
		}
		if fmt.Sprint(resp.ResponseStatus) != "200" {
			return nil, fmt.Errorf("mymemory: %v %s", resp.ResponseStatus, resp.ResponseDetails)
		}
		if strings.HasPrefix(resp.ResponseData.TranslatedText, "MYMEMORY WARNING") {
			return nil, errors.New("mymemory: daily free quota exhausted")
		}
		out[i] = resp.ResponseData.TranslatedText
	}
	return out, nil
}

func truncateUTF8(s string, n int) string {
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

func do(req *http.Request) ([]byte, error) {
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %d %s", req.URL.Host, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return b, nil
}
