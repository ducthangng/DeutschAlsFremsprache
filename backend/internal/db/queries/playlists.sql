-- Playlist columns: owner name, sizes and whether the viewer follows it.

-- name: CreatePlaylist :one
INSERT INTO playlists (user_id, name, description, level, visibility)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- name: UpdatePlaylist :execrows
UPDATE playlists
SET name = sqlc.arg(name), description = sqlc.arg(description), level = sqlc.arg(level),
    visibility = sqlc.arg(visibility), updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: DeletePlaylist :execrows
DELETE FROM playlists WHERE id = $1 AND user_id = $2;

-- Readable by its owner, or by anyone when public.
-- name: GetPlaylistForViewer :one
SELECT p.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM playlist_topics pt WHERE pt.playlist_id = p.id)::int AS topic_count,
       (SELECT COUNT(*) FROM playlist_follows f WHERE f.playlist_id = p.id)::int AS follower_count,
       EXISTS (SELECT 1 FROM playlist_follows f WHERE f.playlist_id = p.id AND f.user_id = sqlc.arg(viewer_id)) AS following
FROM playlists p JOIN users u ON u.id = p.user_id
WHERE p.id = sqlc.arg(id) AND (p.user_id = sqlc.arg(viewer_id) OR p.visibility = 'public');

-- Playlists the viewer owns or follows.
-- name: ListMyPlaylists :many
SELECT p.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM playlist_topics pt WHERE pt.playlist_id = p.id)::int AS topic_count,
       (SELECT COUNT(*) FROM playlist_follows f WHERE f.playlist_id = p.id)::int AS follower_count,
       EXISTS (SELECT 1 FROM playlist_follows f WHERE f.playlist_id = p.id AND f.user_id = sqlc.arg(viewer_id)) AS following
FROM playlists p JOIN users u ON u.id = p.user_id
WHERE p.user_id = sqlc.arg(viewer_id)
   OR (p.visibility = 'public' AND EXISTS (SELECT 1 FROM playlist_follows f WHERE f.playlist_id = p.id AND f.user_id = sqlc.arg(viewer_id)))
ORDER BY p.updated_at DESC;

-- name: ListPublicPlaylists :many
SELECT p.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM playlist_topics pt WHERE pt.playlist_id = p.id)::int AS topic_count,
       (SELECT COUNT(*) FROM playlist_follows f WHERE f.playlist_id = p.id)::int AS follower_count,
       EXISTS (SELECT 1 FROM playlist_follows f WHERE f.playlist_id = p.id AND f.user_id = sqlc.arg(viewer_id)) AS following
FROM playlists p JOIN users u ON u.id = p.user_id
WHERE p.visibility = 'public'
ORDER BY follower_count DESC, p.updated_at DESC
LIMIT 200;

-- name: ListPlaylistTopicIDs :many
SELECT topic_id FROM playlist_topics WHERE playlist_id = $1 ORDER BY position, added_at;

-- Appends at the end; adding twice is a no-op.
-- name: AddPlaylistTopic :exec
INSERT INTO playlist_topics (playlist_id, topic_id, position)
VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_topics WHERE playlist_id = $1))
ON CONFLICT DO NOTHING;

-- name: RemovePlaylistTopic :exec
DELETE FROM playlist_topics WHERE playlist_id = $1 AND topic_id = $2;

-- name: SetPlaylistTopicPosition :exec
UPDATE playlist_topics SET position = $3 WHERE playlist_id = $1 AND topic_id = $2;

-- name: TouchPlaylist :exec
UPDATE playlists SET updated_at = now() WHERE id = $1;

-- Which of the user's own playlists contain a topic (for "Add to playlist").
-- name: OwnPlaylistIDsWithTopic :many
SELECT pt.playlist_id FROM playlist_topics pt JOIN playlists p ON p.id = pt.playlist_id
WHERE p.user_id = $1 AND pt.topic_id = $2;

-- name: FollowPlaylist :exec
INSERT INTO playlist_follows (playlist_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: UnfollowPlaylist :exec
DELETE FROM playlist_follows WHERE playlist_id = $1 AND user_id = $2;

-- Private topics inside a playlist (they must become public when the playlist is public).
-- name: PrivateTopicsInPlaylist :many
SELECT t.id, t.title FROM playlist_topics pt JOIN topics t ON t.id = pt.topic_id
WHERE pt.playlist_id = $1 AND t.visibility = 'private';

-- name: PublicPlaylistsWithTopic :many
SELECT p.id, p.name FROM playlist_topics pt JOIN playlists p ON p.id = pt.playlist_id
WHERE pt.topic_id = $1 AND p.visibility = 'public';

-- name: PublishPlaylistTopics :exec
UPDATE topics SET visibility = 'public'
WHERE user_id = sqlc.arg(user_id) AND visibility = 'private'
  AND id IN (SELECT topic_id FROM playlist_topics WHERE playlist_id = sqlc.arg(playlist_id));
