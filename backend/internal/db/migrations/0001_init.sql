-- Initial schema. Migrations are applied in filename order on server start
-- (see internal/db/migrate.go) and are also the schema source for sqlc.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE CHECK (email = lower(email)),
    name          TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE topics (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    language    TEXT        NOT NULL CHECK (language IN ('de-DE', 'en-US')),
    kind        TEXT        NOT NULL CHECK (kind IN ('vocabulary', 'dialogue')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX topics_user_updated_idx ON topics (user_id, updated_at DESC);

-- One practice line (a vocabulary entry or a dialogue sentence).
CREATE TABLE items (
    id       BIGSERIAL PRIMARY KEY,
    topic_id BIGINT  NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    speaker  TEXT    NOT NULL DEFAULT '',
    text     TEXT    NOT NULL,
    note     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX items_topic_position_idx ON items (topic_id, position);

-- A passed take. The WAV file lives in DATA_DIR/recordings/<file_name>.
CREATE TABLE recordings (
    id           BIGSERIAL PRIMARY KEY,
    item_id      BIGINT           NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    user_id      BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    file_name    TEXT             NOT NULL UNIQUE,
    score        DOUBLE PRECISION NOT NULL,
    accuracy     DOUBLE PRECISION NOT NULL,
    fluency      DOUBLE PRECISION NOT NULL,
    completeness DOUBLE PRECISION NOT NULL,
    result       JSONB            NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX recordings_item_created_idx ON recordings (item_id, created_at DESC);
CREATE INDEX recordings_user_idx ON recordings (user_id);
