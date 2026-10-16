-- name: ListVocab :many
SELECT * FROM vocab_entries
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: CreateVocab :one
INSERT INTO vocab_entries (user_id, language, term, meaning, example, topic_id, image_key)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateVocab :one
UPDATE vocab_entries
SET term = sqlc.arg(term), meaning = sqlc.arg(meaning), example = sqlc.arg(example),
    image_key = sqlc.arg(image_key), updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: DeleteVocab :execrows
DELETE FROM vocab_entries WHERE id = $1 AND user_id = $2;

-- name: GetVocab :one
SELECT * FROM vocab_entries WHERE id = $1 AND user_id = $2;

-- name: ReviewVocab :one
UPDATE vocab_entries
SET ease = sqlc.arg(ease), interval_days = sqlc.arg(interval_days), reps = sqlc.arg(reps),
    due_at = sqlc.arg(due_at), reviews = reviews + 1,
    lapses = lapses + sqlc.arg(lapse)::int, updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: SetVocabImage :one
UPDATE vocab_entries SET image_key = $3, updated_at = now() WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: LogVocabReview :exec
INSERT INTO vocab_reviews (user_id, vocab_id, grade, interval_days, duration_ms)
VALUES ($1, $2, $3, $4, $5);

-- Reviews per local calendar day (offset in minutes from UTC).
-- name: VocabReviewDays :many
SELECT ((reviewed_at AT TIME ZONE 'UTC') + make_interval(mins => sqlc.arg(offset_minutes)::int))::date AS day,
       COUNT(*)::int AS reviews,
       COUNT(*) FILTER (WHERE grade >= 3)::int AS remembered,
       COALESCE(SUM(duration_ms), 0)::bigint AS duration_ms
FROM vocab_reviews
WHERE user_id = sqlc.arg(user_id)
GROUP BY day
ORDER BY day;

-- Used when saving a generated topic's vocabulary; existing terms are kept.
-- name: AddVocabIfMissing :exec
INSERT INTO vocab_entries (user_id, language, term, meaning, topic_id, image_key)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING;

-- The topic owner's word list for a topic (e.g. saved when generating it with AI).
-- name: TopicOwnerVocab :many
SELECT v.term, v.meaning, v.example, v.image_key
FROM vocab_entries v JOIN topics t ON t.id = v.topic_id
WHERE v.topic_id = $1 AND v.user_id = t.user_id
ORDER BY v.created_at;
