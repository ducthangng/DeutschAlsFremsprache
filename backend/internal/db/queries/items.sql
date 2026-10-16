-- name: ListItemsByTopic :many
SELECT * FROM items WHERE topic_id = $1 ORDER BY position;

-- Readable when the topic is the viewer's own or public.
-- name: GetItemForViewer :one
SELECT i.*
FROM items i JOIN topics t ON t.id = i.topic_id
WHERE i.id = sqlc.arg(id) AND (t.user_id = sqlc.arg(viewer_id) OR t.visibility = 'public');

-- name: CreateItem :exec
INSERT INTO items (topic_id, position, speaker, text, note, image_key)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: UpdateItemPosition :exec
UPDATE items SET position = $2, note = $3, image_key = $4 WHERE id = $1;

-- name: DeleteItem :exec
DELETE FROM items WHERE id = $1;
