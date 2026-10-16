package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
	"deutschfremsprache/internal/topic"
)

const maxLines = 300

type topicInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Language    string `json:"language"`
	Kind        string `json:"kind"`
	Visibility  string `json:"visibility"`
	Content     string `json:"content"`
	CoverKey    string `json:"coverKey"`
	// Images[i] is the picture key of the i-th parsed line ("" for none).
	Images []string `json:"images"`
	// Only on create, when the content came from "Tạo bằng AI".
	GenerationIDs []int64           `json:"generationIds"` // every attempt, so regenerations are attributed too
	Vocabulary    []vocabSuggestion `json:"vocabulary"`    // added to the owner's Pocket
}

type vocabSuggestion struct {
	Term    string `json:"term"`
	Meaning string `json:"meaning"`
}

// validate normalizes the input and returns its parsed lines, or an error message.
func (in *topicInput) validate() ([]topic.Line, string) {
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	switch {
	case in.Title == "" || utf8.RuneCountInString(in.Title) > 120:
		return nil, "tiêu đề phải có từ 1 đến 120 ký tự"
	case !topic.Languages[in.Language]:
		return nil, "ngôn ngữ không được hỗ trợ"
	case in.Kind != topic.KindVocabulary && in.Kind != topic.KindDialogue:
		return nil, "loại topic không hợp lệ"
	case len(in.Vocabulary) > 50:
		return nil, "tối đa 50 từ vựng"
	}
	if in.Visibility == "" {
		in.Visibility = "private"
	}
	if in.Visibility != "private" && in.Visibility != "public" {
		return nil, "trạng thái không hợp lệ"
	}
	if !validImageKey(in.CoverKey) {
		return nil, "ảnh bìa không hợp lệ"
	}
	lines := topic.Parse(in.Kind, in.Content)
	if len(lines) == 0 {
		return nil, "nội dung cần ít nhất một dòng"
	}
	if len(lines) > maxLines {
		return nil, "tối đa 300 dòng mỗi topic"
	}
	for i := range lines {
		if utf8.RuneCountInString(lines[i].Text) > 400 {
			return nil, "mỗi câu tối đa 400 ký tự"
		}
		if i < len(in.Images) {
			if !validImageKey(in.Images[i]) {
				return nil, "ảnh của câu không hợp lệ"
			}
			lines[i].ImageKey = in.Images[i]
		}
	}
	return lines, ""
}

func (in *topicInput) toTopic(userID int64) *store.Topic {
	return &store.Topic{UserID: userID, Title: in.Title, Description: in.Description, Language: in.Language, Kind: in.Kind, Visibility: in.Visibility, CoverKey: in.CoverKey}
}

type itemView struct {
	*store.Item
	Recordings []*store.Recording `json:"recordings"`
	// SpeechCached is set for topics with generated (OpenAI) speech: true if
	// the clip already exists in storage, so the UI shows "Loading…" instead
	// of "Generating…".
	SpeechCached *bool `json:"speechCached,omitempty"`
	// Dictation is the viewer's best "Listen -> Write" result for this line.
	Dictation *store.DictationBest `json:"dictation"`
}

type topicDetail struct {
	*store.Topic
	Content  string      `json:"content"`
	Speakers []string    `json:"speakers"`
	Items    []*itemView `json:"items"`
}

// speakerOrder lists the dialogue speakers in order of first appearance; the
// frontend gives each one its own browser voice.
func speakerOrder(items []*store.Item) []string {
	seen := map[string]bool{}
	order := []string{}
	for _, it := range items {
		if it.Speaker != "" && !seen[it.Speaker] {
			seen[it.Speaker] = true
			order = append(order, it.Speaker)
		}
	}
	return order
}

func (s *Server) listTopics(w http.ResponseWriter, r *http.Request) {
	ts, err := s.store.ListTopics(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorate(ts...)
	writeJSON(w, http.StatusOK, ts)
}

func (s *Server) createTopic(w http.ResponseWriter, r *http.Request) {
	var in topicInput
	if !decodeJSON(w, r, &in) {
		return
	}
	lines, msg := in.validate()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if len(in.GenerationIDs) > 20 {
		in.GenerationIDs = in.GenerationIDs[:20]
	}
	extras := store.NewTopicExtras{GenerationIDs: in.GenerationIDs}
	for _, v := range in.Vocabulary {
		if term := strings.TrimSpace(v.Term); term != "" && utf8.RuneCountInString(term) <= 200 {
			extras.Vocabulary = append(extras.Vocabulary, store.VocabEntry{Term: term, Meaning: strings.TrimSpace(v.Meaning)})
		}
	}
	t, err := s.store.CreateTopic(r.Context(), in.toTopic(auth.UserID(r.Context())), lines, extras)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorate(t)
	writeJSON(w, http.StatusCreated, t)
}

func (s *Server) getTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	t, err := s.store.GetTopic(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	items, err := s.store.ListItems(ctx, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	recs, err := s.store.ListRecordingsByTopic(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	byItem := map[int64][]*store.Recording{}
	for _, rec := range recs {
		byItem[rec.ItemID] = append(byItem[rec.ItemID], rec)
	}
	s.decorate(t)
	dict, err := s.store.DictationBest(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	d := &topicDetail{Topic: t, Speakers: speakerOrder(items), Items: make([]*itemView, len(items))}
	var cached map[[2]string]bool
	if s.ttsEnabled(t.Language) {
		hashes := make([]string, len(items))
		for i, it := range items {
			hashes[i] = textHash(it.Text)
		}
		if cached, err = s.store.CachedTTS(ctx, s.openai.TTSModel(), hashes); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	lines := make([]topic.Line, len(items))
	for i, it := range items {
		rs := byItem[it.ID]
		if rs == nil {
			rs = []*store.Recording{}
		}
		it.ImageURL = s.imageURL(it.ImageKey)
		d.Items[i] = &itemView{Item: it, Recordings: rs}
		if b, ok := dict[it.ID]; ok {
			d.Items[i].Dictation = &b
		}
		if cached != nil {
			c := cached[[2]string{voiceFor(d.Speakers, it), textHash(it.Text)}]
			d.Items[i].SpeechCached = &c
		}
		lines[i] = topic.Line{Speaker: it.Speaker, Text: it.Text, Note: it.Note}
	}
	d.Content = topic.Format(lines)
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) updateTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in topicInput
	if !decodeJSON(w, r, &in) {
		return
	}
	lines, msg := in.validate()
	if msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	t := in.toTopic(auth.UserID(r.Context()))
	t.ID = id
	if t.Visibility == "private" {
		if err := s.store.CheckCanMakePrivate(r.Context(), id); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	out, removed, err := s.store.UpdateTopic(r.Context(), t, lines)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.removeRecordingFiles(removed)
	s.decorate(out)
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) deleteTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	files, err := s.store.DeleteTopic(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.removeRecordingFiles(files)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listPublicTopics(w http.ResponseWriter, r *http.Request) {
	ts, err := s.store.ListPublicTopics(r.Context(), auth.UserID(r.Context()))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorate(ts...)
	writeJSON(w, http.StatusOK, ts)
}

func (s *Server) setTopicVisibility(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Visibility string `json:"visibility"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Visibility != "private" && in.Visibility != "public" {
		writeError(w, http.StatusBadRequest, "trạng thái không hợp lệ")
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if in.Visibility == "private" {
		if err := s.store.CheckCanMakePrivate(ctx, id); err != nil {
			writeStoreError(w, err)
			return
		}
	}
	if err := s.store.SetTopicVisibility(ctx, uid, id, in.Visibility); err != nil {
		writeStoreError(w, err)
		return
	}
	t, err := s.store.GetTopic(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorate(t)
	writeJSON(w, http.StatusOK, t)
}

// completeTopic records that the viewer finished every line in one session.
func (s *Server) completeTopic(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if _, err := s.store.GetTopic(ctx, uid, id); err != nil {
		writeStoreError(w, err)
		return
	}
	if err := s.store.AddTopicCompletion(ctx, uid, id); err != nil {
		writeStoreError(w, err)
		return
	}
	t, err := s.store.GetTopic(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.decorate(t)
	writeJSON(w, http.StatusOK, t)
}

// topicCosts breaks a topic's spending down per person.
func (s *Server) topicCosts(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	if _, err := s.store.GetTopic(ctx, uid, id); err != nil {
		writeStoreError(w, err)
		return
	}
	costs, err := s.store.TopicCosts(ctx, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, costs)
}
