package api

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/openai"
	"deutschfremsprache/internal/store"
)

// ---- app-wide costs (admin only) ----

// costSince turns ?period= into a start time: "month" (default), "7d", "today" or "all".
func costSince(period string) (time.Time, bool) {
	now := time.Now()
	switch period {
	case "", "month":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()), true
	case "7d":
		return now.AddDate(0, 0, -7), true
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), true
	case "all":
		return time.Time{}, true
	}
	return time.Time{}, false
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !s.isAdmin(auth.UserID(r.Context())) {
		writeError(w, http.StatusForbidden, "chỉ quản trị viên xem được trang chi phí")
		return false
	}
	return true
}

// costOverview: GET /api/usage/costs?period= — totals by kind, by user and by topic.
func (s *Server) costOverview(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	since, ok := costSince(r.URL.Query().Get("period"))
	if !ok {
		writeError(w, http.StatusBadRequest, "khoảng thời gian không hợp lệ")
		return
	}
	ctx := r.Context()
	totals, err := s.store.CostTotals(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	users, err := s.store.CostByUser(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	for i := range users {
		users[i].AvatarURL = s.imageURL(users[i].AvatarKey)
	}
	topics, err := s.store.CostByTopic(ctx, since)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"since": since, "totals": totals, "users": users, "topics": topics, "providers": s.providers()})
}

// provider is one external service the app calls, as configured right now.
type provider struct {
	Feature string `json:"feature"` // what it is used for (Vietnamese)
	Kind    string `json:"kind"`    // cost kind it is billed under
	Vendor  string `json:"vendor"`  // e.g. "OpenAI", "Microsoft Azure"
	API     string `json:"api"`     // API / model / voice
	Price   string `json:"price"`   // configured unit price used for cost estimates
	Active  bool   `json:"active"`  // false: not configured
	// Fallback is what happens instead while the service is not configured.
	Fallback string `json:"fallback,omitempty"`
}

// providers lists which vendor and API serves each feature, so the admin can
// see where the audio, translations and AI text come from.
func (s *Server) providers() []provider {
	c, oa, az := s.cfg, s.openai.Enabled(), s.speech.Enabled()
	vendorOA := "OpenAI"
	if c.OpenAIBaseURL != "" && !strings.Contains(c.OpenAIBaseURL, "api.openai.com") {
		vendorOA = "OpenAI-compatible (" + c.OpenAIBaseURL + ")"
	}
	azure := func(api string) string { return api + " · region " + c.AzureRegion }
	ps := []provider{
		{Feature: "Chấm phát âm", Kind: "assess", Vendor: "Microsoft Azure", API: azure("Speech: Pronunciation Assessment"),
			Price: fmt.Sprintf("$%g / giờ audio", c.AssessUSDPerHour), Active: az, Fallback: "Chế độ giả lập: điểm ngẫu nhiên, không gọi Azure"},
		{Feature: "Giọng đọc mẫu của topic", Kind: "tts", Vendor: vendorOA, API: "Text-to-speech: " + c.OpenAITTSModel,
			Price: ttsPrice(c), Active: oa, Fallback: "Giọng đọc có sẵn của trình duyệt"},
		{Feature: "Bài nghe ngữ pháp", Kind: "grammar", Vendor: "Microsoft Azure", API: azure("Speech: Neural TTS (de-DE-KatjaNeural, ConradNeural…)"),
			Price: fmt.Sprintf("$%g / 1M ký tự", c.AzureTTSUSDPerMChars), Active: az, Fallback: "Giọng đọc có sẵn của trình duyệt"},
		{Feature: "Nhận dạng giọng nói (mô phỏng)", Kind: "simulation", Vendor: "Microsoft Azure", API: azure("Speech: Speech-to-text"),
			Price: fmt.Sprintf("$%g / giờ audio", c.AzureSTTUSDPerHour), Active: az, Fallback: "Người học phải gõ câu trả lời"},
	}
	if s.translator.Name() == "azure" {
		region := c.TranslatorRegion
		if region == "" {
			region = "global"
		}
		ps = append(ps, provider{Feature: "Dịch nghĩa (Đức → Anh, Anh → Việt)", Kind: "translate", Vendor: "Microsoft Azure",
			API: "Translator Text v3 · region " + region, Price: fmt.Sprintf("$%g / 1M ký tự", c.TranslatorUSDPerMillion), Active: true})
	} else {
		ps = append(ps, provider{Feature: "Dịch nghĩa (Đức → Anh, Anh → Việt)", Kind: "translate", Vendor: "MyMemory (miễn phí)",
			API: "api.mymemory.translated.net · chưa có AZURE_TRANSLATOR_KEY", Price: "Miễn phí", Active: true})
	}
	ps = append(ps,
		provider{Feature: "Kịch bản AI & mô phỏng hội thoại", Kind: "script", Vendor: vendorOA, API: "Chat Completions: " + c.OpenAIChatModel,
			Price: fmt.Sprintf("$%g / $%g mỗi 1M token vào / ra", c.OpenAIChatUSDPerMIn, c.OpenAIChatUSDPerMOut), Active: oa, Fallback: "Tắt (cần OPENAI_API_KEY)"},
		provider{Feature: "Bài tập ngữ pháp", Kind: "grammar", Vendor: vendorOA, API: "Chat Completions: model người dùng chọn (mặc định " + openai.GrammarModels[0].ID + ")",
			Price: "Theo từng model", Active: oa, Fallback: "Tắt (cần OPENAI_API_KEY)"},
		provider{Feature: "Chuẩn hoá từ tiếng Đức khi lưu vào Pocket (mạo từ, chủ ngữ)", Kind: "vocab", Vendor: vendorOA,
			API: "Chat Completions: " + c.OpenAIChatModel, Price: fmt.Sprintf("$%g / $%g mỗi 1M token vào / ra", c.OpenAIChatUSDPerMIn, c.OpenAIChatUSDPerMOut),
			Active: oa, Fallback: "Lưu nguyên từ như đã chọn"},
		provider{Feature: "Chọn giọng đọc hợp tông topic (mỗi topic một lần)", Kind: "voice", Vendor: vendorOA,
			API: "Chat Completions: " + c.OpenAIChatModel, Price: fmt.Sprintf("$%g / $%g mỗi 1M token vào / ra", c.OpenAIChatUSDPerMIn, c.OpenAIChatUSDPerMOut),
			Active: oa, Fallback: "Giọng mặc định theo thứ tự vai"},
		provider{Feature: "Ảnh AI", Kind: "image", Vendor: vendorOA, API: "Images: " + c.OpenAIImageModel,
			Price: fmt.Sprintf("$%g / ảnh", c.OpenAIImageUSD), Active: oa, Fallback: "Tắt (cần OPENAI_API_KEY)"},
	)
	return ps
}

func ttsPrice(c config.Config) string {
	if strings.HasPrefix(c.OpenAITTSModel, "tts-1") {
		return fmt.Sprintf("$%g / 1M ký tự", c.OpenAITTSUSDPerMChars)
	}
	return fmt.Sprintf("$%g / phút audio", c.OpenAITTSUSDPerMinute)
}

var costKinds = []string{"assess", "script", "tts", "image", "simulation", "grammar", "vocab", "voice", "translate"}

const costPageSize = 50

// costRequests: GET /api/usage/requests?period=&user=&kind=&scope=&topic=&offset=
// — the request log, newest first.
func (s *Server) costRequests(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	q := r.URL.Query()
	since, ok := costSince(q.Get("period"))
	f := store.CostEventFilter{Since: since, Kind: q.Get("kind"), Scope: q.Get("scope"), Limit: costPageSize + 1}
	f.UserID, _ = strconv.ParseInt(q.Get("user"), 10, 64)
	f.TopicID, _ = strconv.ParseInt(q.Get("topic"), 10, 64)
	f.Offset, _ = strconv.Atoi(q.Get("offset"))
	switch {
	case !ok:
		writeError(w, http.StatusBadRequest, "khoảng thời gian không hợp lệ")
		return
	case f.Kind != "" && !slices.Contains(costKinds, f.Kind):
		writeError(w, http.StatusBadRequest, "loại request không hợp lệ")
		return
	case f.Scope != "" && f.Scope != "topic" && f.Scope != "simulation" && f.Scope != "none":
		writeError(w, http.StatusBadRequest, "phạm vi không hợp lệ")
		return
	case f.Offset < 0 || f.UserID < 0 || f.TopicID < 0:
		writeError(w, http.StatusBadRequest, "tham số không hợp lệ")
		return
	}
	events, err := s.store.CostEvents(r.Context(), f)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	more := len(events) > costPageSize
	if more {
		events = events[:costPageSize]
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": events, "hasMore": more})
}
