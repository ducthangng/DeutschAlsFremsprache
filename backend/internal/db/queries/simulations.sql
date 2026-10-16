-- name: CreateSimulation :one
INSERT INTO simulations (user_id, language, level, scenario, max_rounds)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetSimulation :one
SELECT * FROM simulations WHERE id = $1 AND user_id = $2;

-- name: ListSimulations :many
SELECT s.*,
       (SELECT COUNT(*) FROM simulation_turns t WHERE t.simulation_id = s.id AND t.speaker = 'user')::int AS user_turns,
       COALESCE((SELECT AVG(t.pron_score) FROM simulation_turns t WHERE t.simulation_id = s.id), 0)::float8 AS avg_pron,
       COALESCE((SELECT AVG(t.logic_score) FROM simulation_turns t WHERE t.simulation_id = s.id), 0)::float8 AS avg_logic,
       ((SELECT COALESCE(SUM(a.cost_usd), 0) FROM assessments a WHERE a.simulation_id = s.id)
        + (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.simulation_id = s.id))::float8 AS cost_usd
FROM simulations s
WHERE s.user_id = $1
ORDER BY s.created_at DESC
LIMIT 100;

-- name: FinishSimulation :exec
UPDATE simulations SET status = 'finished', summary = $3, finished_at = now()
WHERE id = $1 AND user_id = $2;

-- name: CreateSimulationTurn :one
INSERT INTO simulation_turns (simulation_id, round, speaker, text, translation, audio_key, typed,
                              pron_score, accuracy, fluency, logic_score, evaluation, cost_usd)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: ListSimulationTurns :many
SELECT * FROM simulation_turns WHERE simulation_id = $1 ORDER BY id;

-- name: GetSimulationTurn :one
SELECT t.* FROM simulation_turns t JOIN simulations s ON s.id = t.simulation_id
WHERE t.id = $1 AND s.user_id = $2;

-- name: SetTurnAudio :exec
UPDATE simulation_turns SET audio_key = $2, cost_usd = cost_usd + $3 WHERE id = $1;

-- Spending on one simulation, by kind.
-- name: SimulationCosts :one
SELECT (SELECT COALESCE(SUM(a.cost_usd), 0) FROM assessments a WHERE a.simulation_id = $1)::float8 AS speech_usd,
       (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.simulation_id = $1 AND g.kind = 'simulation')::float8 AS llm_usd,
       (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.simulation_id = $1 AND g.kind = 'tts')::float8 AS tts_usd,
       (SELECT COALESCE(SUM(g.input_tokens + g.output_tokens), 0) FROM ai_usage g WHERE g.simulation_id = $1)::bigint AS tokens,
       (SELECT COALESCE(SUM(a.audio_ms), 0) FROM assessments a WHERE a.simulation_id = $1)::bigint AS audio_ms;

-- Material for new scenarios: the learner's recently practiced topics.
-- name: RecentTopicTitles :many
SELECT DISTINCT ON (t.id) t.title, t.description, a.created_at
FROM assessments a JOIN items i ON i.id = a.item_id JOIN topics t ON t.id = i.topic_id
WHERE a.user_id = $1 AND t.language = $2
ORDER BY t.id, a.created_at DESC
LIMIT 20;
