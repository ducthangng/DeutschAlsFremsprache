package api

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/store"
)

var germanFold = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "đ", "d")

// slug makes an ASCII, filesystem-friendly fragment: "Ärztin: Grüß Gott!" ->
// "aerztin-gruess-gott". Other diacritics are stripped (Vietnamese "Chào" -> "chao").
func slug(s string, max int) string {
	s = germanFold.Replace(strings.ToLower(s))
	var b strings.Builder
	dash := false
	for _, r := range norm.NFD.String(s) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.TrimSuffix(b.String(), "-")
	if r := []rune(out); len(r) > max {
		out = strings.TrimSuffix(string(r[:max]), "-")
	}
	if out == "" {
		out = "recording"
	}
	return out
}

// recordingName is the download name of one take, e.g.
// "03-anna-wo-ist-gleis-drei-87-20261016-1415.wav".
func recordingName(it *store.Item, r *store.Recording) string {
	who := ""
	if it.Speaker != "" {
		who = slug(it.Speaker, 16) + "-"
	}
	return fmt.Sprintf("%02d-%s%s-%d-%s.wav", it.Position+1, who, slug(it.Text, 40), int(r.Score+0.5), r.CreatedAt.Local().Format("20060102-150405"))
}

func setAttachment(w http.ResponseWriter, name string) {
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
}

// recordingAudio streams one recording; with ?download=1 it is sent as an
// attachment with a descriptive file name.
func (s *Server) recordingAudio(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	rec, err := s.store.GetRecording(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if r.URL.Query().Get("download") != "" {
		item, t, err := s.store.GetItem(ctx, uid, rec.ItemID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		setAttachment(w, slug(t.Title, 40)+"-"+recordingName(item, rec))
	}
	s.streamRecording(w, r, rec)
}

// streamRecording writes a take's WAV.
func (s *Server) streamRecording(w http.ResponseWriter, r *http.Request, rec *store.Recording) {
	obj, err := s.openRecording(r.Context(), rec.FileName)
	if err != nil {
		log.Printf("open recording %d: %v", rec.ID, err)
		writeError(w, http.StatusNotFound, "không tìm thấy file ghi âm")
		return
	}
	defer obj.Body.Close()
	w.Header().Set("Content-Type", "audio/wav")
	if obj.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(obj.Size, 10))
	}
	io.Copy(w, obj.Body)
}

// topicRecordingsZip bundles every saved recording of a topic into a ZIP.
func (s *Server) topicRecordingsZip(w http.ResponseWriter, r *http.Request) {
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
	if len(recs) == 0 {
		writeError(w, http.StatusNotFound, "topic này chưa có bản ghi nào")
		return
	}
	byID := make(map[int64]*store.Item, len(items))
	for _, it := range items {
		byID[it.ID] = it
	}

	base := slug(t.Title, 40)
	w.Header().Set("Content-Type", "application/zip")
	setAttachment(w, base+"-recordings.zip")
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, rec := range recs {
		obj, err := s.openRecording(ctx, rec.FileName)
		if err != nil {
			log.Printf("zip: open %s: %v", rec.FileName, err)
			continue
		}
		hdr := &zip.FileHeader{Name: base + "/" + recordingName(byID[rec.ItemID], rec), Method: zip.Store, Modified: rec.CreatedAt}
		if dst, err := zw.CreateHeader(hdr); err == nil {
			if _, err := io.Copy(dst, obj.Body); err != nil {
				log.Printf("zip: write %s: %v", rec.FileName, err)
			}
		}
		obj.Body.Close()
	}
}
