package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"deutschfremsprache/internal/api"
	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

func main() {
	cfg := config.Load()
	if cfg.EnvFile != "" {
		log.Printf("config: loaded %s (data: %s)", cfg.EnvFile, cfg.DataDir)
	} else {
		log.Printf("config: no .env file found from %s upwards; using environment variables only", mustGetwd())
	}
	if cfg.JWTSecret == "dev-secret-change-me" {
		log.Println("WARNING: JWT_SECRET is not set, using an insecure development secret")
	}
	if !cfg.AzureEnabled() {
		log.Println("WARNING: AZURE_SPEECH_KEY/AZURE_SPEECH_REGION not set: running in MOCK mode (fake scores)")
	}
	if cfg.TranslatorKey == "" {
		log.Println("AZURE_TRANSLATOR_KEY not set: using the free MyMemory API for Vietnamese meanings")
	}

	st, err := store.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer st.Close()

	app, err := api.New(context.Background(), cfg, st)
	if err != nil {
		log.Fatalf("init: %v", err)
	}
	if cfg.OpenAIKey == "" {
		log.Println("OPENAI_API_KEY not set: AI topic generation disabled, German reference speech uses the browser voice")
	}
	if cfg.S3Bucket == "" {
		log.Println("S3_BUCKET not set: generated audio is stored on local disk under DATA_DIR/media")
	}
	app.MigrateLocalRecordings(context.Background())

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           app.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("listening on http://localhost:%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

func mustGetwd() string {
	wd, _ := os.Getwd()
	return wd
}
