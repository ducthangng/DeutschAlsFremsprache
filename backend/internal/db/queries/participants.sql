-- People who practiced a topic (shadowing or listen-write), most recent first.
-- name: TopicParticipants :many
SELECT u.id, u.name, u.avatar_key, MAX(x.at)::timestamptz AS last_at
FROM (
    SELECT a.user_id, a.created_at AS at FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = sqlc.arg(topic_id)
    UNION ALL
    SELECT d.user_id, d.created_at FROM dictation_attempts d JOIN items i ON i.id = d.item_id WHERE i.topic_id = sqlc.arg(topic_id)
) x
JOIN users u ON u.id = x.user_id
GROUP BY u.id, u.name, u.avatar_key
ORDER BY last_at DESC
LIMIT 60;

-- People taking part in a playlist: its followers and everyone who practiced one of its topics.
-- name: PlaylistParticipants :many
SELECT u.id, u.name, u.avatar_key, MAX(x.at)::timestamptz AS last_at
FROM (
    SELECT f.user_id, f.created_at AS at FROM playlist_follows f WHERE f.playlist_id = sqlc.arg(playlist_id)
    UNION ALL
    SELECT a.user_id, a.created_at FROM assessments a JOIN items i ON i.id = a.item_id
    WHERE i.topic_id IN (SELECT topic_id FROM playlist_topics WHERE playlist_id = sqlc.arg(playlist_id))
    UNION ALL
    SELECT d.user_id, d.created_at FROM dictation_attempts d JOIN items i ON i.id = d.item_id
    WHERE i.topic_id IN (SELECT topic_id FROM playlist_topics WHERE playlist_id = sqlc.arg(playlist_id))
) x
JOIN users u ON u.id = x.user_id
GROUP BY u.id, u.name, u.avatar_key
ORDER BY last_at DESC
LIMIT 60;
