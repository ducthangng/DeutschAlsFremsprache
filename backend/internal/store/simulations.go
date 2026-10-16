package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"deutschfremsprache/internal/db/gen"
)

type Simulation struct {
	ID         int64           `json:"id"`
	Language   string          `json:"language"`
	Level      string          `json:"level"`
	Scenario   json.RawMessage `json:"scenario"`
	Status     string          `json:"status"` // active | finished
	MaxRounds  int             `json:"maxRounds"`
	Summary    json.RawMessage `json:"summary"`
	CreatedAt  time.Time       `json:"createdAt"`
	FinishedAt *time.Time      `json:"finishedAt"`
	// List view only.
	UserTurns int     `json:"userTurns"`
	AvgPron   float64 `json:"avgPron"`
	AvgLogic  float64 `json:"avgLogic"`
	CostUSD   float64 `json:"costUsd"`
}

type SimulationTurn struct {
	ID         int64           `json:"id"`
	Round      int             `json:"round"`
	Speaker    string          `json:"speaker"` // ai | user
	Text       string          `json:"text"`
	Transl     string          `json:"translation"`
	AudioKey   string          `json:"-"`
	HasAudio   bool            `json:"hasAudio"`
	Typed      bool            `json:"typed"`
	PronScore  *float64        `json:"pronScore"`
	Accuracy   *float64        `json:"accuracy"`
	Fluency    *float64        `json:"fluency"`
	LogicScore *float64        `json:"logicScore"`
	Evaluation json.RawMessage `json:"evaluation"`
	CostUSD    float64         `json:"costUsd"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type SimulationCosts struct {
	SpeechUSD float64 `json:"speechUsd"` // Azure transcription + pronunciation
	LLMUSD    float64 `json:"llmUsd"`    // scenario, evaluations, summary
	TTSUSD    float64 `json:"ttsUsd"`    // partner's voice
	TotalUSD  float64 `json:"totalUsd"`
	Tokens    int64   `json:"tokens"`
	AudioSec  float64 `json:"audioSeconds"`
}

func toSimulation(r gen.Simulation) *Simulation {
	s := &Simulation{ID: r.ID, Language: r.Language, Level: r.Level, Scenario: r.Scenario, Status: r.Status, MaxRounds: int(r.MaxRounds),
		Summary: r.Summary, CreatedAt: r.CreatedAt}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		s.FinishedAt = &t
	}
	return s
}

func optF(v pgtype.Float8) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func toF8(v *float64) pgtype.Float8 {
	if v == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *v, Valid: true}
}

func toTurn(r gen.SimulationTurn) *SimulationTurn {
	return &SimulationTurn{ID: r.ID, Round: int(r.Round), Speaker: r.Speaker, Text: r.Text, Transl: r.Translation, AudioKey: r.AudioKey,
		HasAudio: r.AudioKey != "", Typed: r.Typed, PronScore: optF(r.PronScore), Accuracy: optF(r.Accuracy), Fluency: optF(r.Fluency),
		LogicScore: optF(r.LogicScore), Evaluation: r.Evaluation, CostUSD: r.CostUsd, CreatedAt: r.CreatedAt}
}

func (s *Store) CreateSimulation(ctx context.Context, userID int64, language, level string, scenario []byte, maxRounds int) (*Simulation, error) {
	r, err := s.q.CreateSimulation(ctx, gen.CreateSimulationParams{UserID: userID, Language: language, Level: level, Scenario: scenario, MaxRounds: int32(maxRounds)})
	if err != nil {
		return nil, err
	}
	return toSimulation(r), nil
}

func (s *Store) GetSimulation(ctx context.Context, userID, id int64) (*Simulation, error) {
	r, err := s.q.GetSimulation(ctx, gen.GetSimulationParams{ID: id, UserID: userID})
	if err != nil {
		return nil, mapErr(err)
	}
	return toSimulation(r), nil
}

func (s *Store) ListSimulations(ctx context.Context, userID int64) ([]*Simulation, error) {
	rows, err := s.q.ListSimulations(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]*Simulation, len(rows))
	for i, r := range rows {
		sim := toSimulation(gen.Simulation{ID: r.ID, UserID: r.UserID, Language: r.Language, Level: r.Level, Scenario: r.Scenario,
			Status: r.Status, MaxRounds: r.MaxRounds, Summary: r.Summary, CreatedAt: r.CreatedAt, FinishedAt: r.FinishedAt})
		sim.UserTurns, sim.AvgPron, sim.AvgLogic, sim.CostUSD = int(r.UserTurns), r.AvgPron, r.AvgLogic, r.CostUsd
		out[i] = sim
	}
	return out, nil
}

func (s *Store) FinishSimulation(ctx context.Context, userID, id int64, summary []byte) error {
	return s.q.FinishSimulation(ctx, gen.FinishSimulationParams{ID: id, UserID: userID, Summary: summary})
}

func (s *Store) AddSimulationTurn(ctx context.Context, simID int64, t *SimulationTurn) (*SimulationTurn, error) {
	r, err := s.q.CreateSimulationTurn(ctx, gen.CreateSimulationTurnParams{SimulationID: simID, Round: int32(t.Round), Speaker: t.Speaker,
		Text: t.Text, Translation: t.Transl, AudioKey: t.AudioKey, Typed: t.Typed, PronScore: toF8(t.PronScore), Accuracy: toF8(t.Accuracy),
		Fluency: toF8(t.Fluency), LogicScore: toF8(t.LogicScore), Evaluation: t.Evaluation, CostUsd: t.CostUSD})
	if err != nil {
		return nil, err
	}
	return toTurn(r), nil
}

func (s *Store) SimulationTurns(ctx context.Context, simID int64) ([]*SimulationTurn, error) {
	rows, err := s.q.ListSimulationTurns(ctx, simID)
	if err != nil {
		return nil, err
	}
	out := make([]*SimulationTurn, len(rows))
	for i, r := range rows {
		out[i] = toTurn(r)
	}
	return out, nil
}

// GetSimulationTurn returns a turn of one of the user's simulations.
func (s *Store) GetSimulationTurn(ctx context.Context, userID, turnID int64) (*SimulationTurn, int64, error) {
	r, err := s.q.GetSimulationTurn(ctx, gen.GetSimulationTurnParams{ID: turnID, UserID: userID})
	if err != nil {
		return nil, 0, mapErr(err)
	}
	return toTurn(r), r.SimulationID, nil
}

// SetTurnAudio stores the key of generated speech and adds its cost to the turn.
func (s *Store) SetTurnAudio(ctx context.Context, turnID int64, key string, cost float64) error {
	return s.q.SetTurnAudio(ctx, gen.SetTurnAudioParams{ID: turnID, AudioKey: key, CostUsd: cost})
}

func (s *Store) SimulationCosts(ctx context.Context, simID int64) (*SimulationCosts, error) {
	r, err := s.q.SimulationCosts(ctx, pgtype.Int8{Int64: simID, Valid: true})
	if err != nil {
		return nil, err
	}
	return &SimulationCosts{SpeechUSD: r.SpeechUsd, LLMUSD: r.LlmUsd, TTSUSD: r.TtsUsd, TotalUSD: r.SpeechUsd + r.LlmUsd + r.TtsUsd,
		Tokens: r.Tokens, AudioSec: float64(r.AudioMs) / 1000}, nil
}

// RecentTopicTitles lists topics the user practiced recently, as scenario inspiration.
func (s *Store) RecentTopicTitles(ctx context.Context, userID int64, language string) ([]string, error) {
	rows, err := s.q.RecentTopicTitles(ctx, gen.RecentTopicTitlesParams{UserID: userID, Language: language})
	if err != nil {
		return nil, err
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Title
		if r.Description != "" {
			out[i] += " (" + r.Description + ")"
		}
	}
	return out, nil
}
