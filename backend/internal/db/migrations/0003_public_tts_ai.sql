-- Topics can be shared publicly; other users practice them with their own recordings.
ALTER TABLE topics
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
CREATE INDEX topics_public_updated_idx ON topics (updated_at DESC) WHERE visibility = 'public';

-- Cost of the grading that produced a saved recording.
ALTER TABLE recordings ADD COLUMN cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0;

-- One row each time a learner finishes every line of a topic in one session.
CREATE TABLE topic_completions (
    id         BIGSERIAL PRIMARY KEY,
    topic_id   BIGINT      NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX topic_completions_topic_idx ON topic_completions (topic_id);

-- Generated reference audio, shared by every user and topic: the same
-- (model, voice, text) is synthesized once and re-used from storage (S3).
CREATE TABLE tts_audio (
    id           BIGSERIAL PRIMARY KEY,
    model        TEXT             NOT NULL,
    voice        TEXT             NOT NULL,
    language     TEXT             NOT NULL,
    text_hash    TEXT             NOT NULL,  -- sha256 of the text, hex
    text         TEXT             NOT NULL,
    storage_key  TEXT             NOT NULL,
    content_type TEXT             NOT NULL,
    bytes        INTEGER          NOT NULL,
    duration_ms  INTEGER          NOT NULL,
    cost_usd     DOUBLE PRECISION NOT NULL,
    created_by   BIGINT           REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    UNIQUE (model, voice, text_hash)
);

-- Paid OpenAI calls, attributed to the user who triggered them and (when
-- known) the topic they were for.
CREATE TABLE ai_usage (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    topic_id      BIGINT           REFERENCES topics (id) ON DELETE SET NULL,
    kind          TEXT             NOT NULL CHECK (kind IN ('script', 'tts')),
    model         TEXT             NOT NULL,
    input_tokens  INTEGER          NOT NULL DEFAULT 0,
    output_tokens INTEGER          NOT NULL DEFAULT 0,
    chars         INTEGER          NOT NULL DEFAULT 0,
    audio_ms      INTEGER          NOT NULL DEFAULT 0,
    cost_usd      DOUBLE PRECISION NOT NULL,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_topic_idx ON ai_usage (topic_id);
CREATE INDEX ai_usage_user_created_idx ON ai_usage (user_id, created_at);
