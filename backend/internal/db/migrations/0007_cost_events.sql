-- Every paid (or mock) request in one place, for the admin cost page:
-- pronunciation gradings, OpenAI calls and machine translations.
CREATE VIEW cost_events AS
SELECT 'assess'::text           AS kind,
       a.id,
       a.user_id,
       i.topic_id,
       a.simulation_id,
       a.provider,
       COALESCE(i.text, '')     AS detail,
       a.audio_ms,
       0                        AS tokens,
       0                        AS chars,
       a.cost_usd,
       a.created_at
FROM assessments a
LEFT JOIN items i ON i.id = a.item_id
UNION ALL
SELECT g.kind, g.id, g.user_id, g.topic_id, g.simulation_id, g.model, '',
       g.audio_ms, g.input_tokens + g.output_tokens, g.chars, g.cost_usd, g.created_at
FROM ai_usage g
UNION ALL
SELECT 'translate', t.id, t.user_id, NULL::bigint, NULL::bigint, t.provider, t.source_text,
       0, 0, t.chars, t.cost_usd, t.created_at
FROM translations t;

CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS assessments_created_idx ON assessments (created_at);
CREATE INDEX IF NOT EXISTS translations_created_idx ON translations (created_at);
