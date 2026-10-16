-- name: CreateAIUsage :one
INSERT INTO ai_usage (user_id, topic_id, kind, model, input_tokens, output_tokens, chars, audio_ms, cost_usd, simulation_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id;

-- Attach a script generation (made before the topic existed) to the new topic.
-- name: LinkAIUsageToTopic :exec
UPDATE ai_usage SET topic_id = sqlc.arg(topic_id)
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND topic_id IS NULL;

-- name: AIUsageSummary :one
SELECT COUNT(*) FILTER (WHERE kind = 'script')::int AS scripts,
       COALESCE(SUM(cost_usd) FILTER (WHERE kind = 'script'), 0)::float8 AS script_cost_usd,
       COUNT(*) FILTER (WHERE kind = 'tts')::int AS tts_clips,
       COALESCE(SUM(audio_ms) FILTER (WHERE kind = 'tts'), 0)::bigint AS tts_audio_ms,
       COALESCE(SUM(cost_usd) FILTER (WHERE kind = 'tts'), 0)::float8 AS tts_cost_usd,
       COUNT(*) FILTER (WHERE kind = 'image')::int AS images,
       COALESCE(SUM(cost_usd) FILTER (WHERE kind = 'image'), 0)::float8 AS image_cost_usd,
       COALESCE(SUM(cost_usd) FILTER (WHERE kind = 'simulation'), 0)::float8 AS simulation_cost_usd
FROM ai_usage
WHERE user_id = sqlc.arg(user_id) AND created_at >= sqlc.arg(since);

-- name: GetTTSAudio :one
SELECT * FROM tts_audio WHERE model = $1 AND voice = $2 AND text_hash = $3;

-- name: ListTTSHashes :many
SELECT voice, text_hash FROM tts_audio
WHERE model = sqlc.arg(model) AND text_hash = ANY (sqlc.arg(hashes)::text[]);

-- Returns no row when another request stored the same clip first.
-- name: CreateTTSAudio :one
INSERT INTO tts_audio (model, voice, language, text_hash, text, storage_key, content_type, bytes, duration_ms, cost_usd, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (model, voice, text_hash) DO NOTHING
RETURNING *;
