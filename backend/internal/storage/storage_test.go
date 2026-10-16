package storage

import (
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// Runs against an S3-compatible server, e.g.
//
//	docker run -d -p 9090:9090 -e initialBuckets=test adobe/s3mock:3.12.0
//	S3_TEST_ENDPOINT=http://localhost:9090 S3_TEST_BUCKET=test go test ./internal/storage
func TestS3PutAndPresign(t *testing.T) {
	endpoint := os.Getenv("S3_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("S3_TEST_ENDPOINT not set")
	}
	ctx := context.Background()
	s, err := NewS3(ctx, S3Config{Bucket: os.Getenv("S3_TEST_BUCKET"), Region: "us-east-1", Prefix: "test", Endpoint: endpoint,
		AccessKey: "minioadmin", SecretKey: "minioadmin"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "tts/x/voice/abc.wav", []byte("RIFF-data"), "audio/wav"); err != nil {
		t.Fatal(err)
	}
	u, err := s.URL(ctx, "tts/x/voice/abc.wav", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(b) != "RIFF-data" || resp.Header.Get("Content-Type") != "audio/wav" {
		t.Fatalf("presigned get: %d %q %s", resp.StatusCode, b, resp.Header.Get("Content-Type"))
	}
}

func TestLocalSignedURL(t *testing.T) {
	l := &Local{Dir: t.TempDir(), BaseURL: "/m/", Secret: []byte("k")}
	if err := l.Put(context.Background(), "a/b.wav", []byte("x"), ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Put(context.Background(), "../escape", []byte("x"), ""); err == nil {
		t.Fatal("path traversal accepted")
	}
}
