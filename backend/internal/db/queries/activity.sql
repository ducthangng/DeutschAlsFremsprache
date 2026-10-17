-- Admin activity feed: one row per learner session. Practice and dictation
-- are grouped per (user, topic, day in Vietnam time); a simulation is one
-- row; creating a topic is one row. Filters are off when empty / 0.
-- name: ListActivity :many
WITH ev AS (
    SELECT 'shadow'::text AS kind, a.user_id, i.topic_id, 0::bigint AS simulation_id,
           (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE a.passed)::int AS passed,
           COUNT(DISTINCT a.item_id)::int AS lines,
           AVG(a.pron_score)::float8 AS avg_score,
           MIN(a.created_at)::timestamptz AS started_at,
           MAX(a.created_at)::timestamptz AS last_at
    FROM assessments a
    JOIN items i ON i.id = a.item_id
    WHERE a.simulation_id IS NULL
    GROUP BY a.user_id, i.topic_id, day
    UNION ALL
    SELECT 'write', d.user_id, i.topic_id, 0,
           (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
           COUNT(*)::int, COUNT(*) FILTER (WHERE d.passed)::int, COUNT(DISTINCT d.item_id)::int,
           AVG(d.score)::float8, MIN(d.created_at), MAX(d.created_at)
    FROM dictation_attempts d
    JOIN items i ON i.id = d.item_id
    GROUP BY d.user_id, i.topic_id, (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    UNION ALL
    SELECT 'simulation', s.user_id, 0, s.id,
           (s.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
           COUNT(t.id)::int, 0, COUNT(t.id)::int,
           COALESCE(AVG(t.pron_score), 0)::float8, s.created_at, COALESCE(MAX(t.created_at), s.created_at)
    FROM simulations s
    LEFT JOIN simulation_turns t ON t.simulation_id = s.id AND t.speaker = 'user'
    GROUP BY s.id
    UNION ALL
    SELECT 'create', t.user_id, t.id, 0,
           (t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
           0, 0, 0, 0, t.created_at, t.created_at
    FROM topics t
)
SELECT ev.kind::text AS kind,
       ev.user_id::bigint AS user_id,
       u.name AS user_name,
       u.avatar_key AS user_avatar_key,
       ev.topic_id::bigint AS topic_id,
       COALESCE(tp.title, '')::text AS topic_title,
       COALESCE(tp.language, s.language, '')::text AS language,
       (SELECT COUNT(*) FROM items it WHERE it.topic_id = ev.topic_id)::int AS topic_lines,
       ev.simulation_id::bigint AS simulation_id,
       COALESCE(s.scenario ->> 'title', '')::text AS simulation_title,
       COALESCE(s.status, '')::text AS simulation_status,
       to_char(ev.day, 'YYYY-MM-DD')::text AS day,
       ev.attempts, ev.passed, ev.lines, ev.avg_score,
       ev.started_at::timestamptz AS started_at,
       ev.last_at::timestamptz AS last_at,
       (ev.kind IN ('shadow', 'write') AND EXISTS (
           SELECT 1 FROM topic_completions c
           WHERE c.user_id = ev.user_id AND c.topic_id = ev.topic_id
             AND (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = ev.day))::bool AS completed
FROM ev
JOIN users u ON u.id = ev.user_id
LEFT JOIN topics tp ON tp.id = ev.topic_id AND ev.kind <> 'simulation'
LEFT JOIN simulations s ON s.id = ev.simulation_id AND ev.kind = 'simulation'
WHERE (sqlc.arg(user_id)::bigint = 0 OR ev.user_id = sqlc.arg(user_id))
  AND (sqlc.arg(kind)::text = '' OR ev.kind = sqlc.arg(kind))
ORDER BY ev.last_at DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: ListTopicItems :many
SELECT id, position, speaker, text, note FROM items WHERE topic_id = $1 ORDER BY position;

-- name: AdminDayAssessments :many
SELECT a.item_id::bigint AS item_id, a.pron_score, a.passed, a.audio_ms, a.created_at
FROM assessments a
JOIN items i ON i.id = a.item_id
WHERE a.user_id = sqlc.arg(user_id) AND i.topic_id = sqlc.arg(topic_id) AND a.simulation_id IS NULL
  AND (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = sqlc.arg(day)::date
ORDER BY a.created_at;

-- name: AdminDayRecordings :many
SELECT r.*
FROM recordings r
JOIN items i ON i.id = r.item_id
WHERE r.user_id = sqlc.arg(user_id) AND i.topic_id = sqlc.arg(topic_id)
  AND (r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = sqlc.arg(day)::date
ORDER BY r.created_at;

-- name: AdminDayDictation :many
SELECT d.id, d.item_id, d.answer, d.score, d.passed, d.created_at
FROM dictation_attempts d
JOIN items i ON i.id = d.item_id
WHERE d.user_id = sqlc.arg(user_id) AND i.topic_id = sqlc.arg(topic_id)
  AND (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = sqlc.arg(day)::date
ORDER BY d.created_at;

-- name: AdminGetRecording :one
SELECT * FROM recordings WHERE id = $1;

-- name: AdminGetSimulation :one
SELECT * FROM simulations WHERE id = $1;
