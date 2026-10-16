-- Flashcards move from Leitner boxes to SM-2 style scheduling
-- (ease factor + interval), and every review is logged for statistics.
ALTER TABLE vocab_entries
    ADD COLUMN ease          DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    ADD COLUMN interval_days DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN reps          INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN image_key     TEXT             NOT NULL DEFAULT '';
-- Carry over Leitner progress: box n rested 1, 2, 4, 8, 16, 32 days.
UPDATE vocab_entries
SET reps = box, interval_days = CASE WHEN box > 0 THEN power(2, box - 1) ELSE 0 END;
ALTER TABLE vocab_entries DROP COLUMN box;

CREATE TABLE vocab_reviews (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    vocab_id      BIGINT           REFERENCES vocab_entries (id) ON DELETE SET NULL,
    grade         SMALLINT         NOT NULL CHECK (grade BETWEEN 1 AND 4), -- 1 again, 2 hard, 3 good, 4 easy
    interval_days DOUBLE PRECISION NOT NULL,                               -- interval after this review
    duration_ms   INTEGER          NOT NULL DEFAULT 0,                     -- time spent on the card
    reviewed_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX vocab_reviews_user_time_idx ON vocab_reviews (user_id, reviewed_at);

-- Simulations: improvised conversations generated from the learner's history.
CREATE TABLE simulations (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    language    TEXT        NOT NULL CHECK (language IN ('de-DE', 'en-US')),
    level       TEXT        NOT NULL,
    scenario    JSONB       NOT NULL,  -- title, setting, partner, user role, goal, …
    status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    max_rounds  INTEGER     NOT NULL DEFAULT 10,
    summary     JSONB,                 -- final evaluation, set when finished
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX simulations_user_idx ON simulations (user_id, created_at DESC);

-- One message of a simulation. User turns carry the transcript, the audio,
-- the pronunciation scores and the content evaluation.
CREATE TABLE simulation_turns (
    id            BIGSERIAL PRIMARY KEY,
    simulation_id BIGINT           NOT NULL REFERENCES simulations (id) ON DELETE CASCADE,
    round         INTEGER          NOT NULL,              -- 0 = opening line
    speaker       TEXT             NOT NULL CHECK (speaker IN ('ai', 'user')),
    text          TEXT             NOT NULL,
    translation   TEXT             NOT NULL DEFAULT '',   -- Vietnamese
    audio_key     TEXT             NOT NULL DEFAULT '',   -- user recording or generated AI speech
    typed         BOOLEAN          NOT NULL DEFAULT false, -- user typed instead of speaking
    pron_score    DOUBLE PRECISION,
    accuracy      DOUBLE PRECISION,
    fluency       DOUBLE PRECISION,
    logic_score   DOUBLE PRECISION,
    evaluation    JSONB,                                  -- feedback, correction, grammar notes
    cost_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,    -- everything spent producing this turn
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX simulation_turns_sim_idx ON simulation_turns (simulation_id, id);

-- Attribute spending to simulations, and allow new paid AI kinds.
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('script', 'tts', 'image', 'simulation'));
ALTER TABLE ai_usage ADD COLUMN simulation_id BIGINT REFERENCES simulations (id) ON DELETE SET NULL;
ALTER TABLE assessments ADD COLUMN simulation_id BIGINT REFERENCES simulations (id) ON DELETE SET NULL;
CREATE INDEX ai_usage_simulation_idx ON ai_usage (simulation_id);
CREATE INDEX assessments_simulation_idx ON assessments (simulation_id);
