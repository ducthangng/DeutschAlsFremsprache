// Package storage keeps generated audio files: on AWS S3 (or any
// S3-compatible service) when configured, otherwise on local disk.
package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ErrNotFound is returned by Get for a missing object.
var ErrNotFound = errors.New("object not found")

type Object struct {
	Body        io.ReadCloser
	Size        int64
	ContentType string
}

type Storage interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
	// Get streams an object through the server (for authenticated downloads).
	Get(ctx context.Context, key string) (*Object, error)
	Delete(ctx context.Context, key string) error
	// URL returns a time-limited URL the browser can play directly.
	URL(ctx context.Context, key string, ttl time.Duration) (string, error)
	Name() string
}

// ---- S3 ----

type S3Config struct {
	Bucket, Region, Prefix string
	Endpoint               string // optional: MinIO, Cloudflare R2, …
	AccessKey, SecretKey   string // optional: else the default AWS credential chain
}

type S3 struct {
	cfg     S3Config
	client  *s3.Client
	presign *s3.PresignClient
}

func NewS3(ctx context.Context, c S3Config) (*S3, error) {
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(c.Region)}
	if c.AccessKey != "" {
		opts = append(opts, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(c.AccessKey, c.SecretKey, "")))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if c.Endpoint != "" {
			o.BaseEndpoint = aws.String(c.Endpoint)
			o.UsePathStyle = true
		}
	})
	return &S3{cfg: c, client: client, presign: s3.NewPresignClient(client)}, nil
}

func (s *S3) Name() string { return "s3" }

func (s *S3) key(k string) string { return strings.TrimSuffix(s.cfg.Prefix, "/") + "/" + k }

func (s *S3) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(s.cfg.Bucket),
		Key:          aws.String(s.key(key)),
		Body:         bytes.NewReader(data),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String("public, max-age=31536000, immutable"), // content-addressed keys never change
	})
	return err
}

func (s *S3) Get(ctx context.Context, key string) (*Object, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(s.key(key))})
	if err != nil {
		var nsk *types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &Object{Body: out.Body, Size: aws.ToInt64(out.ContentLength), ContentType: aws.ToString(out.ContentType)}, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(s.key(key))})
	return err
}

func (s *S3) URL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.cfg.Bucket), Key: aws.String(s.key(key))},
		s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

// ---- local disk ----

// Local stores files under Dir and serves them through ServeHTTP with
// HMAC-signed, expiring URLs (the browser's <audio> cannot send auth headers).
type Local struct {
	Dir     string
	BaseURL string // path the handler is mounted on, e.g. "/api/media/"
	Secret  []byte
}

func (l *Local) Name() string { return "local" }

func (l *Local) path(key string) (string, error) {
	clean := filepath.Clean("/" + key)
	if strings.Contains(key, "..") || clean == "/" {
		return "", errors.New("invalid key")
	}
	return filepath.Join(l.Dir, clean), nil
}

func (l *Local) Put(_ context.Context, key string, data []byte, _ string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (l *Local) Get(_ context.Context, key string) (*Object, error) {
	p, err := l.path(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if os.IsNotExist(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &Object{Body: f, Size: st.Size(), ContentType: mime.TypeByExtension(filepath.Ext(p))}, nil
}

func (l *Local) Delete(_ context.Context, key string) error {
	p, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *Local) sign(key string, exp int64) string {
	m := hmac.New(sha256.New, l.Secret)
	fmt.Fprintf(m, "%s|%d", key, exp)
	return hex.EncodeToString(m.Sum(nil))
}

func (l *Local) URL(_ context.Context, key string, ttl time.Duration) (string, error) {
	exp := time.Now().Add(ttl).Unix()
	return l.BaseURL + key + "?" + url.Values{"exp": {strconv.FormatInt(exp, 10)}, "sig": {l.sign(key, exp)}}.Encode(), nil
}

// ServeHTTP serves a file if its URL signature is valid and unexpired.
func (l *Local) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, l.BaseURL)
	exp, err := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if err != nil || time.Now().Unix() > exp || !hmac.Equal([]byte(r.URL.Query().Get("sig")), []byte(l.sign(key, exp))) {
		http.Error(w, "link expired or invalid", http.StatusForbidden)
		return
	}
	p, err := l.path(key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, p)
}
