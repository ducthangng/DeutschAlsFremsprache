-- German words saved to the Pocket are rewritten into their card form by
-- OpenAI (die Zeitung, liest (du)); those calls are billed as 'vocab'.
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('script', 'tts', 'image', 'simulation', 'grammar', 'vocab'));
