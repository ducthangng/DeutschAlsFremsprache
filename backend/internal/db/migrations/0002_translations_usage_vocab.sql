-- Machine translations, cached so each (language pair, text) is paid for once.
CREATE TABLE translations (
    id              BIGSERIAL PRIMARY KEY,
    source_lang     TEXT        NOT NULL,
    target_lang     TEXT        NOT NULL,
    source_text     TEXT        NOT NULL,
    translated_text TEXT        NOT NULL,
    provider        TEXT        NOT NULL,           -- azure | mymemory
    chars           INTEGER     NOT NULL,           -- billable source characters
    cost_usd        DOUBLE PRECISION NOT NULL DEFAULT 0,
    user_id         BIGINT      REFERENCES users (id) ON DELETE SET NULL, -- who caused the (paid) lookup
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_lang, target_lang, source_text)
);
CREATE INDEX translations_user_created_idx ON translations (user_id, created_at);

-- Every pronunciation grading (passed or not), with its estimated cost.
CREATE TABLE assessments (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id    BIGINT           REFERENCES items (id) ON DELETE SET NULL,
    provider   TEXT             NOT NULL,           -- azure | mock
    audio_ms   INTEGER          NOT NULL,           -- billed audio length
    latency_ms INTEGER          NOT NULL,
    pron_score DOUBLE PRECISION NOT NULL,
    passed     BOOLEAN          NOT NULL,
    cost_usd   DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX assessments_user_created_idx ON assessments (user_id, created_at DESC);

-- Vocabulary Pocket: personal flash cards with Leitner-box spaced repetition.
CREATE TABLE vocab_entries (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    language   TEXT        NOT NULL CHECK (language IN ('de-DE', 'en-US')),
    term       TEXT        NOT NULL CHECK (term <> ''),
    meaning    TEXT        NOT NULL DEFAULT '',
    example    TEXT        NOT NULL DEFAULT '',
    topic_id   BIGINT      REFERENCES topics (id) ON DELETE SET NULL,
    box        INTEGER     NOT NULL DEFAULT 0,      -- 0 = new, 1..6 = Leitner box
    due_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviews    INTEGER     NOT NULL DEFAULT 0,
    lapses     INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vocab_entries_user_term_idx ON vocab_entries (user_id, language, lower(term));
CREATE INDEX vocab_entries_user_due_idx ON vocab_entries (user_id, due_at);
