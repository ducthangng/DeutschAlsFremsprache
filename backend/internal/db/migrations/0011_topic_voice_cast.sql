-- How a topic is read aloud: tone and a voice per speaker, chosen once by
-- OpenAI ('' = not chosen yet; reset when the text changes). Those casting
-- calls are billed as 'voice'.
ALTER TABLE topics ADD COLUMN voice_cast TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('script', 'tts', 'image', 'simulation', 'grammar', 'vocab', 'voice'));
