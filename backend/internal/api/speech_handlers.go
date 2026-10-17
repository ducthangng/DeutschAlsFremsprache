package api

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"deutschfremsprache/internal/auth"
	"deutschfremsprache/internal/speech"
	"deutschfremsprache/internal/store"
)

const maxAudioBytes = 10 << 20 // ~5 minutes of 16 kHz mono PCM

// gradingUsage describes what one grading cost, shown next to the score.
type gradingUsage struct {
	Provider  string  `json:"provider"` // azure | mock
	AudioMs   int     `json:"audioMs"`
	LatencyMs int     `json:"latencyMs"`
	CostUSD   float64 `json:"costUsd"`
}

type assessResponse struct {
	Passed     bool             `json:"passed"`
	Threshold  float64          `json:"threshold"`
	Scores     speech.Scores    `json:"scores"`
	Tokens     []speech.Token   `json:"tokens"`
	Recognized string           `json:"recognized"`
	Recording  *store.Recording `json:"recording"`
	Mock       bool             `json:"mock"`
	Usage      gradingUsage     `json:"usage"`
}

// assessItem scores an uploaded WAV recording against the item text, logs the
// grading's cost, and keeps the recording if it passes.
func (s *Server) assessItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx, uid := r.Context(), auth.UserID(r.Context())
	item, t, err := s.store.GetItem(ctx, uid, id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	wav, err := readWAVUpload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Optional "focus": grade just one word/phrase of the sentence (re-practicing
	// mispronounced words). Such takes are not saved as recordings.
	ref := item.Text
	focus := strings.TrimSpace(r.FormValue("focus"))
	if focus != "" {
		if utf8.RuneCountInString(focus) > 80 || !strings.Contains(strings.ToLower(item.Text), strings.ToLower(focus)) {
			writeError(w, http.StatusBadRequest, "từ cần luyện không có trong câu")
			return
		}
		ref = focus
	}

	usage := gradingUsage{Provider: "azure", AudioMs: wavDurationMs(wav)}
	var a *speech.Assessment
	start := time.Now()
	if !s.speech.Enabled() {
		usage.Provider = "mock"
		a = speech.MockAssess(ref, len(wav))
	} else {
		a, err = s.speech.Assess(ctx, t.Language, ref, wav)
		if err != nil {
			log.Printf("assess: %v", err)
			writeError(w, http.StatusBadGateway, "không chấm được phát âm, vui lòng thử lại")
			return
		}
		usage.CostUSD = float64(usage.AudioMs) / 3_600_000 * s.cfg.AssessUSDPerHour
	}
	usage.LatencyMs = int(time.Since(start).Milliseconds())

	resp := assessResponse{
		Threshold:  s.cfg.PassThreshold,
		Scores:     a.Scores,
		Tokens:     speech.Align(ref, a.Words, s.cfg.WordThreshold),
		Recognized: a.Recognized,
		Mock:       usage.Provider == "mock",
		Usage:      usage,
	}
	resp.Passed = len(a.Words) > 0 && a.PronScore >= s.cfg.PassThreshold

	if err := s.store.LogAssessment(ctx, store.Assessment{UserID: uid, ItemID: &item.ID, Provider: usage.Provider, AudioMs: usage.AudioMs,
		LatencyMs: usage.LatencyMs, PronScore: a.PronScore, Passed: resp.Passed, CostUSD: usage.CostUSD}); err != nil {
		log.Printf("log assessment: %v", err) // cost tracking must not block the learner
	}

	if resp.Passed && focus == "" {
		rec, err := s.saveRecording(r, uid, item.ID, wav, &resp)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		resp.Recording = rec
	}
	writeJSON(w, http.StatusOK, resp)
}

// wavDurationMs reads the audio length from the WAV header (byte rate and
// data chunk size), which is what Azure bills for.
func wavDurationMs(wav []byte) int {
	if len(wav) < 44 {
		return 0
	}
	byteRate := binary.LittleEndian.Uint32(wav[28:32])
	if byteRate == 0 {
		return 0
	}
	dataLen := uint32(len(wav) - 44)
	for off := 12; off+8 <= len(wav); {
		size := binary.LittleEndian.Uint32(wav[off+4 : off+8])
		if string(wav[off:off+4]) == "data" {
			dataLen = min(size, uint32(len(wav)-off-8))
			break
		}
		off += 8 + int(size) + int(size&1)
	}
	return int(uint64(dataLen) * 1000 / uint64(byteRate))
}

func readWAVUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAudioBytes+1<<16)
	f, _, err := r.FormFile("audio")
	if err != nil {
		return nil, errors.New("thiếu file ghi âm")
	}
	defer f.Close()
	wav, err := io.ReadAll(io.LimitReader(f, maxAudioBytes+1))
	if err != nil {
		return nil, errors.New("không đọc được file ghi âm")
	}
	if len(wav) > maxAudioBytes {
		return nil, errors.New("bản ghi quá dài")
	}
	if len(wav) < 44 || !bytes.Equal(wav[0:4], []byte("RIFF")) || !bytes.Equal(wav[8:12], []byte("WAVE")) {
		return nil, errors.New("file ghi âm phải là WAV PCM 16 kHz")
	}
	return wav, nil
}

func (s *Server) saveRecording(r *http.Request, uid, itemID int64, wav []byte, resp *assessResponse) (*store.Recording, error) {
	var rnd [12]byte
	rand.Read(rnd[:])
	name := fmt.Sprintf("recordings/u%d/i%d-%s.wav", uid, itemID, hex.EncodeToString(rnd[:]))
	if err := s.media.Put(r.Context(), name, wav, "audio/wav"); err != nil {
		return nil, fmt.Errorf("upload recording: %w", err)
	}
	result, _ := json.Marshal(map[string]any{"tokens": resp.Tokens, "recognized": resp.Recognized})
	rec := &store.Recording{
		ItemID: itemID, UserID: uid, FileName: name,
		Score: resp.Scores.PronScore, Accuracy: resp.Scores.AccuracyScore,
		Fluency: resp.Scores.FluencyScore, Completeness: resp.Scores.CompletenessScore,
		CostUSD: resp.Usage.CostUSD, Result: result,
	}
	if err := s.store.CreateRecording(r.Context(), rec); err != nil {
		s.removeRecordingFiles([]string{name})
		return nil, err
	}
	return rec, nil
}

func (s *Server) deleteRecording(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	file, err := s.store.DeleteRecording(r.Context(), auth.UserID(r.Context()), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	s.removeRecordingFiles([]string{file})
	w.WriteHeader(http.StatusNoContent)
}
