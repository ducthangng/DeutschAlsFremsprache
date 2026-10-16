-- name: GetTranslations :many
SELECT source_text, translated_text, provider
FROM translations
WHERE source_lang = sqlc.arg(source_lang) AND target_lang = sqlc.arg(target_lang)
  AND source_text = ANY (sqlc.arg(texts)::text[]);

-- name: SaveTranslation :exec
INSERT INTO translations (source_lang, target_lang, source_text, translated_text, provider, chars, cost_usd, user_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (source_lang, target_lang, source_text) DO NOTHING;

-- name: TranslationUsage :one
SELECT COUNT(*)::int AS requests,
       COALESCE(SUM(chars), 0)::bigint AS chars,
       COALESCE(SUM(cost_usd), 0)::float8 AS cost_usd
FROM translations
WHERE user_id = sqlc.arg(user_id) AND created_at >= sqlc.arg(since);
