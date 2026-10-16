-- name: CreateRecording :one
INSERT INTO recordings (item_id, user_id, file_name, score, accuracy, fluency, completeness, result, cost_usd)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListRecordingsByTopic :many
SELECT r.*
FROM recordings r JOIN items i ON i.id = r.item_id
WHERE i.topic_id = sqlc.arg(topic_id) AND r.user_id = sqlc.arg(user_id)
ORDER BY r.created_at DESC;

-- name: GetRecordingForUser :one
SELECT * FROM recordings WHERE id = $1 AND user_id = $2;

-- name: DeleteRecording :one
DELETE FROM recordings WHERE id = $1 AND user_id = $2
RETURNING file_name;

-- name: ListRecordingFilesByItem :many
SELECT file_name FROM recordings WHERE item_id = $1;

-- name: ListRecordingFilesByTopic :many
SELECT r.file_name
FROM recordings r
JOIN items i ON i.id = r.item_id
JOIN topics t ON t.id = i.topic_id
WHERE t.id = sqlc.arg(topic_id) AND t.user_id = sqlc.arg(user_id);

-- Recordings saved on local disk before they moved to media storage.
-- name: ListLegacyRecordings :many
SELECT id, file_name FROM recordings WHERE file_name NOT LIKE 'recordings/%';

-- name: SetRecordingFileName :exec
UPDATE recordings SET file_name = $2 WHERE id = $1;
