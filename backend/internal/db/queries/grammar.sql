-- name: CreateGrammarSet :one
INSERT INTO grammar_sets (user_id, grammar, level, model, sections)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetGrammarSet :one
SELECT * FROM grammar_sets WHERE id = $1 AND user_id = $2;

-- name: ListGrammarSets :many
SELECT id, grammar, level, model, sections, status, error, COALESCE(content->>'title', '')::text AS title, cost_usd, created_at, updated_at,
       (answers IS NOT NULL)::bool AS started, (answers -> 'progress')::jsonb AS progress
FROM grammar_sets
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: FinishGrammarSet :exec
UPDATE grammar_sets
SET status = sqlc.arg(status), error = sqlc.arg(error), content = sqlc.arg(content), audio_key = sqlc.arg(audio_key),
    cost_usd = cost_usd + sqlc.arg(cost_usd)::float8, updated_at = now()
WHERE id = sqlc.arg(id);

-- name: SaveGrammarAnswers :execrows
UPDATE grammar_sets SET answers = $3, updated_at = now()
WHERE id = $1 AND user_id = $2 AND status = 'ready';

-- name: SaveGrammarWritingFeedback :exec
UPDATE grammar_sets
SET writing_feedback = sqlc.arg(feedback), cost_usd = cost_usd + sqlc.arg(cost_usd)::float8, updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- The listening audio stays in storage: it is the shared tts_audio cache.
-- name: DeleteGrammarSet :execrows
DELETE FROM grammar_sets WHERE id = $1 AND user_id = $2;

-- Generations cut short by a restart never finish; let the learner retry.
-- name: FailStaleGrammarSets :exec
UPDATE grammar_sets SET status = 'failed', error = 'máy chủ khởi động lại trong lúc tạo bài', updated_at = now()
WHERE status = 'generating';

