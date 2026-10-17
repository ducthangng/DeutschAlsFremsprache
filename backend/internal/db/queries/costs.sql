-- name: CostTotalsByKind :many
SELECT e.kind::text AS kind,
       COUNT(*)::int AS requests,
       COALESCE(SUM(e.cost_usd), 0)::float8 AS cost_usd,
       COALESCE(SUM(e.audio_ms), 0)::bigint AS audio_ms,
       COALESCE(SUM(e.tokens), 0)::bigint AS tokens,
       COALESCE(SUM(e.chars), 0)::bigint AS chars
FROM cost_events e
WHERE e.created_at >= sqlc.arg(since)
GROUP BY e.kind
ORDER BY cost_usd DESC;

-- Translations of deleted users have no user: user_id 0.
-- name: CostByUser :many
SELECT COALESCE(e.user_id, 0)::bigint AS user_id,
       COALESCE(u.name, '')::text AS name,
       COALESCE(u.email, '')::text AS email,
       COALESCE(u.avatar_key, '')::text AS avatar_key,
       COUNT(*)::int AS requests,
       COALESCE(SUM(e.cost_usd), 0)::float8 AS cost_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind = 'assess'), 0)::float8 AS grading_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind IN ('script', 'tts', 'image', 'simulation')), 0)::float8 AS ai_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind = 'translate'), 0)::float8 AS translation_usd,
       MAX(e.created_at)::timestamptz AS last_at
FROM cost_events e
LEFT JOIN users u ON u.id = e.user_id
WHERE e.created_at >= sqlc.arg(since)
GROUP BY e.user_id, u.name, u.email, u.avatar_key
ORDER BY cost_usd DESC, requests DESC;

-- scope: "topic" (one row per topic), "simulation" (all simulations) or
-- "none" (not tied to anything: translations, flashcard pictures, unsaved scripts).
-- name: CostByTopic :many
SELECT (CASE WHEN e.topic_id IS NOT NULL THEN 'topic'
             WHEN e.simulation_id IS NOT NULL THEN 'simulation'
             ELSE 'none' END)::text AS scope,
       COALESCE(e.topic_id, 0)::bigint AS topic_id,
       COALESCE(t.title, '')::text AS title,
       COALESCE(t.language, '')::text AS language,
       COALESCE(o.name, '')::text AS owner_name,
       COUNT(DISTINCT e.user_id)::int AS users,
       COUNT(*)::int AS requests,
       COALESCE(SUM(e.cost_usd), 0)::float8 AS cost_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind = 'assess'), 0)::float8 AS grading_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind IN ('script', 'tts', 'image', 'simulation')), 0)::float8 AS ai_usd,
       COALESCE(SUM(e.cost_usd) FILTER (WHERE e.kind = 'translate'), 0)::float8 AS translation_usd
FROM cost_events e
LEFT JOIN topics t ON t.id = e.topic_id
LEFT JOIN users o ON o.id = t.user_id
WHERE e.created_at >= sqlc.arg(since)
GROUP BY 1, 2, 3, 4, 5
ORDER BY cost_usd DESC, requests DESC;

-- Filters are off when empty / 0.
-- name: ListCostEvents :many
SELECT e.kind::text AS kind,
       e.id::bigint AS id,
       COALESCE(e.user_id, 0)::bigint AS user_id,
       COALESCE(u.name, '')::text AS user_name,
       COALESCE(e.topic_id, 0)::bigint AS topic_id,
       COALESCE(t.title, '')::text AS topic_title,
       COALESCE(e.simulation_id, 0)::bigint AS simulation_id,
       COALESCE(s.scenario ->> 'title', '')::text AS simulation_title,
       e.provider::text AS provider,
       e.detail::text AS detail,
       e.audio_ms::int AS audio_ms,
       e.tokens::int AS tokens,
       e.chars::int AS chars,
       e.cost_usd::float8 AS cost_usd,
       e.created_at::timestamptz AS created_at
FROM cost_events e
LEFT JOIN users u ON u.id = e.user_id
LEFT JOIN topics t ON t.id = e.topic_id
LEFT JOIN simulations s ON s.id = e.simulation_id
WHERE e.created_at >= sqlc.arg(since)
  AND (sqlc.arg(user_id)::bigint = 0 OR e.user_id = sqlc.arg(user_id))
  AND (sqlc.arg(kind)::text = '' OR e.kind = sqlc.arg(kind))
  AND (sqlc.arg(scope)::text = ''
       OR (sqlc.arg(scope) = 'topic' AND e.topic_id = sqlc.arg(topic_id)::bigint)
       OR (sqlc.arg(scope) = 'simulation' AND e.topic_id IS NULL AND e.simulation_id IS NOT NULL)
       OR (sqlc.arg(scope) = 'none' AND e.topic_id IS NULL AND e.simulation_id IS NULL))
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);
