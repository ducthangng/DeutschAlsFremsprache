-- Topic columns shared by the list/detail queries. passed_count is per viewer;
-- completions and total_cost_usd are across everyone.

-- name: ListTopicsByUser :many
SELECT t.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM items i WHERE i.topic_id = t.id)::int AS item_count,
       (SELECT COUNT(DISTINCT r.item_id) FROM recordings r JOIN items i ON i.id = r.item_id
         WHERE i.topic_id = t.id AND r.user_id = sqlc.arg(user_id))::int AS passed_count,
       (SELECT COUNT(DISTINCT d.item_id) FROM dictation_attempts d JOIN items i ON i.id = d.item_id
         WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(user_id) AND d.passed)::int AS dictation_passed_count,
       (SELECT COALESCE(GREATEST(
            (SELECT MAX(a.created_at) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id AND a.user_id = sqlc.arg(user_id)),
            (SELECT MAX(d.created_at) FROM dictation_attempts d JOIN items i ON i.id = d.item_id WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(user_id))),
          'epoch'::timestamptz))::timestamptz AS last_practiced_at,
       (SELECT COUNT(*) FROM topic_completions c WHERE c.topic_id = t.id)::int AS completions,
       ((SELECT COALESCE(SUM(a.cost_usd), 0) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id)
        + (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.topic_id = t.id))::float8 AS total_cost_usd
FROM topics t JOIN users u ON u.id = t.user_id
WHERE t.user_id = sqlc.arg(user_id)
ORDER BY t.updated_at DESC;

-- name: ListPublicTopics :many
SELECT t.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM items i WHERE i.topic_id = t.id)::int AS item_count,
       (SELECT COUNT(DISTINCT r.item_id) FROM recordings r JOIN items i ON i.id = r.item_id
         WHERE i.topic_id = t.id AND r.user_id = sqlc.arg(viewer_id))::int AS passed_count,
       (SELECT COUNT(DISTINCT d.item_id) FROM dictation_attempts d JOIN items i ON i.id = d.item_id
         WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(viewer_id) AND d.passed)::int AS dictation_passed_count,
       (SELECT COALESCE(GREATEST(
            (SELECT MAX(a.created_at) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id AND a.user_id = sqlc.arg(viewer_id)),
            (SELECT MAX(d.created_at) FROM dictation_attempts d JOIN items i ON i.id = d.item_id WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(viewer_id))),
          'epoch'::timestamptz))::timestamptz AS last_practiced_at,
       (SELECT COUNT(*) FROM topic_completions c WHERE c.topic_id = t.id)::int AS completions,
       ((SELECT COALESCE(SUM(a.cost_usd), 0) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id)
        + (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.topic_id = t.id))::float8 AS total_cost_usd
FROM topics t JOIN users u ON u.id = t.user_id
WHERE t.visibility = 'public'
ORDER BY t.updated_at DESC
LIMIT 200;

-- Readable by its owner, or by anyone when public.
-- name: GetTopicForViewer :one
SELECT t.*, u.name AS owner_name,
       (SELECT COUNT(*) FROM items i WHERE i.topic_id = t.id)::int AS item_count,
       (SELECT COUNT(DISTINCT r.item_id) FROM recordings r JOIN items i ON i.id = r.item_id
         WHERE i.topic_id = t.id AND r.user_id = sqlc.arg(viewer_id))::int AS passed_count,
       (SELECT COUNT(DISTINCT d.item_id) FROM dictation_attempts d JOIN items i ON i.id = d.item_id
         WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(viewer_id) AND d.passed)::int AS dictation_passed_count,
       (SELECT COALESCE(GREATEST(
            (SELECT MAX(a.created_at) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id AND a.user_id = sqlc.arg(viewer_id)),
            (SELECT MAX(d.created_at) FROM dictation_attempts d JOIN items i ON i.id = d.item_id WHERE i.topic_id = t.id AND d.user_id = sqlc.arg(viewer_id))),
          'epoch'::timestamptz))::timestamptz AS last_practiced_at,
       (SELECT COUNT(*) FROM topic_completions c WHERE c.topic_id = t.id)::int AS completions,
       ((SELECT COALESCE(SUM(a.cost_usd), 0) FROM assessments a JOIN items i ON i.id = a.item_id WHERE i.topic_id = t.id)
        + (SELECT COALESCE(SUM(g.cost_usd), 0) FROM ai_usage g WHERE g.topic_id = t.id))::float8 AS total_cost_usd
FROM topics t JOIN users u ON u.id = t.user_id
WHERE t.id = sqlc.arg(id) AND (t.user_id = sqlc.arg(viewer_id) OR t.visibility = 'public');

-- name: CreateTopic :one
INSERT INTO topics (user_id, title, description, language, kind, visibility, cover_key)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id;

-- name: UpdateTopic :execrows
UPDATE topics
SET title = sqlc.arg(title), description = sqlc.arg(description),
    language = sqlc.arg(language), kind = sqlc.arg(kind),
    visibility = sqlc.arg(visibility), cover_key = sqlc.arg(cover_key), updated_at = now()
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: SetTopicVisibility :execrows
UPDATE topics SET visibility = $3 WHERE id = $1 AND user_id = $2;

-- name: DeleteTopic :execrows
DELETE FROM topics WHERE id = $1 AND user_id = $2;

-- name: AddTopicCompletion :exec
INSERT INTO topic_completions (topic_id, user_id) VALUES ($1, $2);

-- Who spent what on a topic.
-- name: TopicCostsByUser :many
SELECT u.id AS user_id, u.name,
       COALESCE(SUM(x.grading), 0)::float8    AS grading_cost_usd,
       COALESCE(SUM(x.script), 0)::float8     AS script_cost_usd,
       COALESCE(SUM(x.tts), 0)::float8        AS tts_cost_usd,
       COALESCE(SUM(x.gradings), 0)::int      AS gradings
FROM (
    SELECT a.user_id, a.cost_usd AS grading, 0::float8 AS script, 0::float8 AS tts, 1 AS gradings
    FROM assessments a JOIN items i ON i.id = a.item_id
    WHERE i.topic_id = sqlc.arg(topic_id)
    UNION ALL
    SELECT g.user_id, 0::float8,
           CASE WHEN g.kind = 'script' THEN g.cost_usd ELSE 0 END,
           CASE WHEN g.kind = 'tts' THEN g.cost_usd ELSE 0 END,
           0
    FROM ai_usage g
    WHERE g.topic_id = sqlc.arg(topic_id)
) x
JOIN users u ON u.id = x.user_id
GROUP BY u.id, u.name
ORDER BY SUM(x.grading + x.script + x.tts) DESC;
