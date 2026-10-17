package store

import (
	"context"
	"time"

	"deutschfremsprache/internal/db/gen"
)

// ---- app-wide costs (admin) ----

type CostKindTotal struct {
	Kind     string  `json:"kind"` // assess | script | tts | image | simulation | translate
	Requests int     `json:"requests"`
	CostUSD  float64 `json:"costUsd"`
	AudioMs  int64   `json:"audioMs"`
	Tokens   int64   `json:"tokens"`
	Chars    int64   `json:"chars"`
}

// CostSplit is a cost divided by what was paid for.
type CostSplit struct {
	Requests       int     `json:"requests"`
	CostUSD        float64 `json:"costUsd"`
	GradingUSD     float64 `json:"gradingUsd"`
	AIUSD          float64 `json:"aiUsd"`
	TranslationUSD float64 `json:"translationUsd"`
}

type UserCost struct {
	UserID    int64     `json:"userId"` // 0: deleted user
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	AvatarKey string    `json:"-"`
	AvatarURL string    `json:"avatarUrl"`
	LastAt    time.Time `json:"lastAt"`
	CostSplit
}

type TopicSpend struct {
	Scope     string `json:"scope"` // topic | simulation | none
	TopicID   int64  `json:"topicId"`
	Title     string `json:"title"`
	Language  string `json:"language"`
	OwnerName string `json:"ownerName"`
	Users     int    `json:"users"`
	CostSplit
}

type CostEvent struct {
	Kind            string    `json:"kind"`
	ID              int64     `json:"id"`
	UserID          int64     `json:"userId"`
	UserName        string    `json:"userName"`
	TopicID         int64     `json:"topicId"`
	TopicTitle      string    `json:"topicTitle"`
	SimulationID    int64     `json:"simulationId"`
	SimulationTitle string    `json:"simulationTitle"`
	Provider        string    `json:"provider"`
	Detail          string    `json:"detail"`
	AudioMs         int       `json:"audioMs"`
	Tokens          int       `json:"tokens"`
	Chars           int       `json:"chars"`
	CostUSD         float64   `json:"costUsd"`
	CreatedAt       time.Time `json:"createdAt"`
}

// CostEventFilter narrows the request log; zero values mean "all".
type CostEventFilter struct {
	Since   time.Time
	UserID  int64
	Kind    string
	Scope   string // topic | simulation | none
	TopicID int64
	Offset  int
	Limit   int
}

func (s *Store) CostTotals(ctx context.Context, since time.Time) ([]CostKindTotal, error) {
	rows, err := s.q.CostTotalsByKind(ctx, since)
	if err != nil {
		return nil, err
	}
	out := make([]CostKindTotal, len(rows))
	for i, r := range rows {
		out[i] = CostKindTotal{Kind: r.Kind, Requests: int(r.Requests), CostUSD: r.CostUsd, AudioMs: r.AudioMs, Tokens: r.Tokens, Chars: r.Chars}
	}
	return out, nil
}

func (s *Store) CostByUser(ctx context.Context, since time.Time) ([]UserCost, error) {
	rows, err := s.q.CostByUser(ctx, since)
	if err != nil {
		return nil, err
	}
	out := make([]UserCost, len(rows))
	for i, r := range rows {
		out[i] = UserCost{UserID: r.UserID, Name: r.Name, Email: r.Email, AvatarKey: r.AvatarKey, LastAt: r.LastAt,
			CostSplit: CostSplit{Requests: int(r.Requests), CostUSD: r.CostUsd, GradingUSD: r.GradingUsd, AIUSD: r.AiUsd, TranslationUSD: r.TranslationUsd}}
	}
	return out, nil
}

func (s *Store) CostByTopic(ctx context.Context, since time.Time) ([]TopicSpend, error) {
	rows, err := s.q.CostByTopic(ctx, since)
	if err != nil {
		return nil, err
	}
	out := make([]TopicSpend, len(rows))
	for i, r := range rows {
		out[i] = TopicSpend{Scope: r.Scope, TopicID: r.TopicID, Title: r.Title, Language: r.Language, OwnerName: r.OwnerName, Users: int(r.Users),
			CostSplit: CostSplit{Requests: int(r.Requests), CostUSD: r.CostUsd, GradingUSD: r.GradingUsd, AIUSD: r.AiUsd, TranslationUSD: r.TranslationUsd}}
	}
	return out, nil
}

func (s *Store) CostEvents(ctx context.Context, f CostEventFilter) ([]CostEvent, error) {
	rows, err := s.q.ListCostEvents(ctx, gen.ListCostEventsParams{Since: f.Since, UserID: f.UserID, Kind: f.Kind, Scope: f.Scope,
		TopicID: f.TopicID, Off: int32(f.Offset), Lim: int32(f.Limit)})
	if err != nil {
		return nil, err
	}
	out := make([]CostEvent, len(rows))
	for i, r := range rows {
		out[i] = CostEvent{Kind: r.Kind, ID: r.ID, UserID: r.UserID, UserName: r.UserName, TopicID: r.TopicID, TopicTitle: r.TopicTitle,
			SimulationID: r.SimulationID, SimulationTitle: r.SimulationTitle, Provider: r.Provider, Detail: r.Detail, AudioMs: int(r.AudioMs),
			Tokens: int(r.Tokens), Chars: int(r.Chars), CostUSD: r.CostUsd, CreatedAt: r.CreatedAt}
	}
	return out, nil
}
