-- name: CreateGrammarSet :one
INSERT INTO grammar_sets (user_id, grammar, level, model, sections, vocab_level, vocabulary)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetGrammarSet :one
SELECT * FROM grammar_sets WHERE id = $1 AND user_id = $2;

-- name: ListGrammarSets :many
SELECT id, grammar, level, model, sections, status, error, pending, COALESCE(content->>'title', '')::text AS title, cost_usd, created_at, updated_at,
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

-- name: ClearStaleGrammarPending :exec
UPDATE grammar_sets SET pending = '' WHERE pending <> '';

-- Claims the set for generating one part; no row when another part is under way.
-- name: StartGrammarSection :one
UPDATE grammar_sets SET pending = sqlc.arg(section)::text, updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND status = 'ready' AND pending = ''
RETURNING id;

-- Stores a newly generated part and starts it afresh: its answers, checked
-- flag and progress (and, for writing, the grading) are cleared in place so
-- answers saved meanwhile for other parts are kept.
-- name: FinishGrammarSection :exec
UPDATE grammar_sets
SET content = sqlc.arg(content), sections = sqlc.arg(sections), audio_key = sqlc.arg(audio_key),
    cost_usd = cost_usd + sqlc.arg(cost_usd)::float8, pending = '', updated_at = now(),
    answers = CASE WHEN answers IS NULL THEN NULL ELSE
        answers || jsonb_build_object(sqlc.arg(section)::text, '{}'::jsonb,
                                      'checked', COALESCE(answers -> 'checked', '{}'::jsonb) - sqlc.arg(section)::text,
                                      'progress', COALESCE(answers -> 'progress', '{}'::jsonb) - sqlc.arg(section)::text) END,
    writing_feedback = CASE WHEN sqlc.arg(section)::text = 'writing' THEN NULL ELSE writing_feedback END
WHERE id = sqlc.arg(id);

-- A part that could not be generated: the old one stays, with the reason.
-- name: FailGrammarSection :exec
UPDATE grammar_sets SET content = sqlc.arg(content), cost_usd = cost_usd + sqlc.arg(cost_usd)::float8, pending = '', updated_at = now()
WHERE id = sqlc.arg(id);

