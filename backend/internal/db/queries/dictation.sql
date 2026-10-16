-- name: CreateDictationAttempt :exec
INSERT INTO dictation_attempts (user_id, item_id, answer, score, passed)
VALUES ($1, $2, $3, $4, $5);

-- Best score per line of a topic for one user.
-- name: DictationBestScores :many
SELECT d.item_id, MAX(d.score)::float8 AS best_score, BOOL_OR(d.passed) AS passed
FROM dictation_attempts d JOIN items i ON i.id = d.item_id
WHERE i.topic_id = sqlc.arg(topic_id) AND d.user_id = sqlc.arg(user_id)
GROUP BY d.item_id;
