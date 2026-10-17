-- Spoken practice of one user in one topic since a time (a session).
-- name: SessionSpeaking :one
SELECT COALESCE(SUM(a.audio_ms), 0)::bigint AS audio_ms,
       COALESCE(AVG(a.pron_score) FILTER (WHERE a.pron_score > 0), 0)::float8 AS avg_score,
       COUNT(*)::int AS gradings
FROM assessments a JOIN items i ON i.id = a.item_id
WHERE i.topic_id = sqlc.arg(topic_id) AND a.user_id = sqlc.arg(user_id) AND a.created_at >= sqlc.arg(since)
  AND a.provider IN ('azure', 'mock');

-- name: SessionDictation :one
SELECT COALESCE(AVG(d.score), 0)::float8 AS avg_score, COUNT(*)::int AS attempts
FROM dictation_attempts d JOIN items i ON i.id = d.item_id
WHERE i.topic_id = sqlc.arg(topic_id) AND d.user_id = sqlc.arg(user_id) AND d.created_at >= sqlc.arg(since);

-- All speaking time of a user (pronunciation gradings; transcription rows would double count).
-- name: TotalSpeakingMs :one
SELECT COALESCE(SUM(audio_ms), 0)::bigint FROM assessments
WHERE user_id = $1 AND provider IN ('azure', 'mock');

-- Average pronunciation score of every user who has been graded.
-- name: UserAverageScores :many
SELECT user_id, AVG(pron_score)::float8 AS avg_score
FROM assessments
WHERE provider IN ('azure', 'mock') AND pron_score > 0
GROUP BY user_id;

-- name: VocabAddedSince :many
SELECT * FROM vocab_entries WHERE user_id = $1 AND created_at >= $2 ORDER BY created_at;
