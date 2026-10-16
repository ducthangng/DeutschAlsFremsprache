-- name: CreateAssessment :exec
INSERT INTO assessments (user_id, item_id, provider, audio_ms, latency_ms, pron_score, passed, cost_usd, simulation_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: AssessmentUsage :one
SELECT COUNT(*)::int AS gradings,
       COUNT(*) FILTER (WHERE passed)::int AS passed,
       COALESCE(SUM(audio_ms), 0)::bigint AS audio_ms,
       COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
FROM assessments
WHERE user_id = sqlc.arg(user_id) AND created_at >= sqlc.arg(since) AND provider = 'azure';

-- name: ListRecentAssessments :many
SELECT a.id, a.provider, a.audio_ms, a.latency_ms, a.pron_score, a.passed, a.cost_usd, a.created_at,
       COALESCE(i.text, '')::text AS item_text,
       COALESCE(t.title, '')::text AS topic_title
FROM assessments a
LEFT JOIN items i ON i.id = a.item_id
LEFT JOIN topics t ON t.id = i.topic_id
WHERE a.user_id = $1
ORDER BY a.created_at DESC
LIMIT $2;
