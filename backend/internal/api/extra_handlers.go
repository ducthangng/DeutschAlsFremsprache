package api

import (
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
	"deutschfremsprache/internal/topic"
)

// ---- translation ----

const (
	maxTranslateTexts = 300
	maxTranslateChars = 400
)

type translateRequest struct {
	Language string   `json:"language"` // de-DE | en-US (source)
	Texts    []string `json:"texts"`
}

type translateResponse struct {
	Translations []string `json:"translations"` // same order as the request
	Provider     string   `json:"provider"`
	CostUSD      float64  `json:"costUsd"` // cost of the uncached part of this request
	Chars        int      `json:"chars"`
}

// translateTexts returns Vietnamese translations, serving from the Postgres
// cache and only sending unseen texts to the translation provider.
func (s *Server) translateTexts(w http.ResponseWriter, r *http.Request) {
	var in translateRequest
	if !decodeJSON(w, r, &in) {
		return
	}
	if !topic.Languages[in.Language] {
		writeError(w, http.StatusBadRequest, "ngôn ngữ không được hỗ trợ")
		return
	}
	if len(in.Texts) == 0 || len(in.Texts) > maxTranslateTexts {
		writeError(w, http.StatusBadRequest, "cần từ 1 đến 300 đoạn văn bản")
		return
	}
	texts := make([]string, len(in.Texts))
	for i, t := range in.Texts {
		texts[i] = strings.TrimSpace(t)
		if texts[i] == "" || utf8.RuneCountInString(texts[i]) > maxTranslateChars {
			writeError(w, http.StatusBadRequest, "mỗi đoạn cần từ 1 đến 400 ký tự")
			return
		}
	}
	from, to := in.Language[:2], "vi"
	ctx, uid := r.Context(), auth.UserID(r.Context())

	cached, err := s.store.CachedTranslations(ctx, from, to, texts)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	var missing []string
	seen := map[string]bool{}
	for _, t := range texts {
		if _, ok := cached[t]; !ok && !seen[t] {
			seen[t] = true
			missing = append(missing, t)
		}
	}
	resp := translateResponse{Provider: s.translator.Name(), Translations: make([]string, len(texts))}
	if len(missing) > 0 {
		out, err := s.translator.Translate(ctx, from, to, missing)
		if err != nil {
			log.Printf("translate: %v", err)
			writeError(w, http.StatusBadGateway, "không dịch được lúc này, vui lòng thử lại sau")
			return
		}
		for i, src := range missing {
			chars := utf8.RuneCountInString(src)
			cost := s.translator.CostUSD(chars)
			resp.Chars += chars
			resp.CostUSD += cost
			cached[src] = store.CachedTranslation{Text: out[i], Provider: s.translator.Name()}
			if err := s.store.SaveTranslation(ctx, uid, from, to, src, out[i], s.translator.Name(), chars, cost); err != nil {
				log.Printf("cache translation: %v", err)
			}
		}
	}
	for i, t := range texts {
		resp.Translations[i] = cached[t].Text
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- usage / cost ----

func (s *Server) usage(w http.ResponseWriter, r *http.Request) {
	ctx, uid := r.Context(), auth.UserID(r.Context())
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	month, err := s.store.Usage(ctx, uid, monthStart)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	all, err := s.store.Usage(ctx, uid, time.Time{})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	monthAI, err := s.store.AIUsageSince(ctx, uid, monthStart)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	allAI, err := s.store.AIUsageSince(ctx, uid, time.Time{})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	recent, err := s.store.RecentAssessments(ctx, uid, 50)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":     month,
		"allTime":   all,
		"monthAi":   monthAI,
		"allTimeAi": allAI,
		"recent":    recent,
		"pricing": map[string]any{
			"assessUsdPerHour":      s.cfg.AssessUSDPerHour,
			"translatorUsdPerMChar": s.cfg.TranslatorUSDPerMillion,
			"translator":            s.translator.Name(),
			"chatModel":             s.cfg.OpenAIChatModel,
			"chatUsdPerMInput":      s.cfg.OpenAIChatUSDPerMIn,
			"chatUsdPerMOutput":     s.cfg.OpenAIChatUSDPerMOut,
			"ttsModel":              s.cfg.OpenAITTSModel,
			"ttsUsdPerMinute":       s.cfg.OpenAITTSUSDPerMinute,
			"storage":               s.media.Name(),
		},
	})
}
