// Package config loads runtime settings from environment variables, seeded
// from a .env file: $ENV_FILE, or the nearest .env in the working directory
// or one of its parents (so `go run ./cmd/server` works from any subfolder).
package config

import (
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port             string
	DatabaseURL      string
	DataDir          string
	StaticDir        string
	JWTSecret        string
	CORSOrigin       string // comma-separated; "https://*.vercel.app" style wildcards allowed
	PublicURL        string // absolute base of this API, e.g. https://api.example.com (for media links)
	AzureKey         string
	AzureRegion      string
	TranslatorKey    string
	TranslatorRegion string
	MyMemoryEmail    string
	// Price estimates used for cost tracking (USD).
	AssessUSDPerHour        float64
	TranslatorUSDPerMillion float64
	OpenAIKey               string
	OpenAIBaseURL           string
	OpenAIChatModel         string
	OpenAIChatUSDPerMIn     float64
	OpenAIChatUSDPerMOut    float64
	OpenAITTSModel          string
	OpenAITTSUSDPerMinute   float64
	OpenAITTSUSDPerMChars   float64
	OpenAIImageModel        string
	OpenAIImageUSD          float64 // per generated image
	AzureSTTUSDPerHour      float64 // plain transcription (simulations)
	S3Bucket                string
	S3Region                string
	S3Prefix                string
	S3Endpoint              string
	AWSAccessKey            string
	AWSSecretKey            string
	PassThreshold           float64 // PronScore needed for a sentence to pass
	WordThreshold           float64 // AccuracyScore below which a word is marked wrong

	EnvFile string // the .env that was loaded, "" if none
}

// AzureEnabled reports whether real Azure credentials are configured.
// Without them the server runs in mock mode.
func (c Config) AzureEnabled() bool {
	return c.AzureKey != "" && c.AzureRegion != ""
}

// findEnvFile returns $ENV_FILE, or the nearest .env walking up from the
// working directory.
func findEnvFile() string {
	if f := os.Getenv("ENV_FILE"); f != "" {
		return f
	}
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		if f := filepath.Join(dir, ".env"); fileExists(f) {
			return f
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// Load reads the .env file (variables already set in the shell win) and then
// the environment. Relative DATA_DIR / STATIC_DIR are resolved against the
// .env file's folder, so the server finds the same data from any start directory.
func Load() Config {
	envFile := findEnvFile()
	base := ""
	if envFile != "" {
		if err := godotenv.Load(envFile); err != nil {
			log.Printf("read %s: %v", envFile, err)
		}
		base = filepath.Dir(envFile)
	}
	resolve := func(p string) string {
		if base == "" || filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(base, p)
	}
	cfg := loadEnv()
	cfg.EnvFile = envFile
	cfg.DataDir = resolve(cfg.DataDir)
	cfg.StaticDir = resolve(cfg.StaticDir)
	return cfg
}

func loadEnv() Config {
	return Config{
		Port:             env("PORT", "8080"),
		DatabaseURL:      env("DATABASE_URL", "postgres://dfs:dfs@localhost:5432/deutschfremsprache?sslmode=disable"),
		DataDir:          env("DATA_DIR", "./data"),
		StaticDir:        env("STATIC_DIR", "../frontend/dist"),
		JWTSecret:        env("JWT_SECRET", "dev-secret-change-me"),
		CORSOrigin:       env("CORS_ORIGIN", ""),
		PublicURL:        strings.TrimRight(env("PUBLIC_URL", ""), "/"),
		AzureKey:         env("AZURE_SPEECH_KEY", ""),
		AzureRegion:      env("AZURE_SPEECH_REGION", ""),
		TranslatorKey:    env("AZURE_TRANSLATOR_KEY", ""),
		TranslatorRegion: env("AZURE_TRANSLATOR_REGION", env("AZURE_SPEECH_REGION", "")),
		MyMemoryEmail:    env("MYMEMORY_EMAIL", ""),
		// Speech-to-text (~$1/h) + pronunciation assessment add-on (~$1/h).
		AssessUSDPerHour:        envFloat("AZURE_ASSESS_USD_PER_HOUR", 2.0),
		TranslatorUSDPerMillion: envFloat("AZURE_TRANSLATOR_USD_PER_MILLION_CHARS", 10.0),
		OpenAIKey:               env("OPENAI_API_KEY", ""),
		OpenAIBaseURL:           env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAIChatModel:         env("OPENAI_CHAT_MODEL", "gpt-4.1-mini"),
		// List prices (USD) at the time of writing; adjust if they change.
		OpenAIChatUSDPerMIn:   envFloat("OPENAI_CHAT_USD_PER_M_INPUT", 0.40),
		OpenAIChatUSDPerMOut:  envFloat("OPENAI_CHAT_USD_PER_M_OUTPUT", 1.60),
		OpenAITTSModel:        env("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
		OpenAITTSUSDPerMinute: envFloat("OPENAI_TTS_USD_PER_MINUTE", 0.015),
		OpenAITTSUSDPerMChars: envFloat("OPENAI_TTS_USD_PER_MILLION_CHARS", 15),
		OpenAIImageModel:      env("OPENAI_IMAGE_MODEL", "gpt-image-1"),
		OpenAIImageUSD:        envFloat("OPENAI_IMAGE_USD", 0.011), // gpt-image-1, low quality, 1024x1024
		AzureSTTUSDPerHour:    envFloat("AZURE_STT_USD_PER_HOUR", 1.0),
		S3Bucket:              env("S3_BUCKET", ""),
		S3Region:              env("AWS_REGION", "eu-central-1"),
		S3Prefix:              env("S3_PREFIX", "deutschfremsprache"),
		S3Endpoint:            env("S3_ENDPOINT", ""),
		AWSAccessKey:          env("AWS_ACCESS_KEY_ID", ""),
		AWSSecretKey:          env("AWS_SECRET_ACCESS_KEY", ""),
		PassThreshold:         envFloat("PASS_THRESHOLD", 70),
		WordThreshold:         envFloat("WORD_THRESHOLD", 60),
	}
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, err := strconv.ParseFloat(env(key, ""), 64); err == nil {
		return v
	}
	return def
}
