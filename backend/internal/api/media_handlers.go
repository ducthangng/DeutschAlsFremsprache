package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"deutschfremsprache/internal/storage"
	"deutschfremsprache/internal/store"
)

const (
	maxImageBytes = 5 << 20
	imagePath     = "/api/img/"
)

var (
	imageKeyRe = regexp.MustCompile(`^images/[0-9a-f]{64}\.(jpg|png|webp|gif)$`)
	imageExt   = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
)

func validImageKey(k string) bool { return k == "" || imageKeyRe.MatchString(k) }

// imageURL signs an image key. The expiry is rounded to whole days so the URL
// stays identical for a day and the browser can cache the picture.
func (s *Server) imageURL(key string) string {
	if key == "" {
		return ""
	}
	day := int64(24 * time.Hour / time.Second)
	exp := (time.Now().Unix()/day + 2) * day
	return imagePath + key + "?" + url.Values{"exp": {strconv.FormatInt(exp, 10)}, "sig": {s.signImage(key, exp)}}.Encode()
}

func (s *Server) signImage(key string, exp int64) string {
	m := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	fmt.Fprintf(m, "img|%s|%d", key, exp)
	return hex.EncodeToString(m.Sum(nil))
}

// decorate fills in the signed picture URLs of topics (and their lines).
func (s *Server) decorate(ts ...*store.Topic) {
	for _, t := range ts {
		t.CoverURL = s.imageURL(t.CoverKey)
	}
}

// uploadImage stores a picture (cover or line image) and returns its key and URL.
// Keys are content hashes, so uploading the same picture twice is free.
func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+1<<16)
	f, _, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "thiếu file ảnh (tối đa 5 MB)")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil || len(data) > maxImageBytes {
		writeError(w, http.StatusBadRequest, "ảnh tối đa 5 MB")
		return
	}
	if _, ok := imageExt[http.DetectContentType(data)]; !ok {
		writeError(w, http.StatusBadRequest, "chỉ nhận ảnh JPG, PNG, WebP hoặc GIF")
		return
	}
	key, err := s.putImage(r, data)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"key": key, "url": s.imageURL(key)})
}

// putImage stores a picture under a content-addressed key.
func (s *Server) putImage(r *http.Request, data []byte) (string, error) {
	ctype := http.DetectContentType(data)
	ext, ok := imageExt[ctype]
	if !ok {
		return "", errors.New("định dạng ảnh không được hỗ trợ")
	}
	sum := sha256.Sum256(data)
	key := "images/" + hex.EncodeToString(sum[:]) + "." + ext
	if err := s.media.Put(r.Context(), key, data, ctype); err != nil {
		log.Printf("store image: %v", err)
		return "", errors.New("không lưu được ảnh")
	}
	return key, nil
}

// serveImage streams a picture from media storage if its URL signature is valid.
func (s *Server) serveImage(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, imagePath)
	exp, err := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if err != nil || !imageKeyRe.MatchString(key) || time.Now().Unix() > exp ||
		!hmac.Equal([]byte(r.URL.Query().Get("sig")), []byte(s.signImage(key, exp))) {
		http.Error(w, "link expired or invalid", http.StatusForbidden)
		return
	}
	obj, err := s.media.Get(r.Context(), key)
	if errors.Is(err, storage.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		log.Printf("serve image %s: %v", key, err)
		http.Error(w, "storage error", http.StatusBadGateway)
		return
	}
	defer obj.Body.Close()
	if obj.ContentType != "" {
		w.Header().Set("Content-Type", obj.ContentType)
	}
	if obj.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(obj.Size, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	io.Copy(w, obj.Body)
}
