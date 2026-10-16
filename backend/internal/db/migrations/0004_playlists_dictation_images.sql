-- Pictures: a cover per topic and an optional picture per line. Keys point
-- into media storage (S3 or local disk).
ALTER TABLE topics ADD COLUMN cover_key TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN image_key TEXT NOT NULL DEFAULT '';

-- Playlists: ordered collections of topics, optionally published for others to follow.
CREATE TABLE playlists (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    level       TEXT        NOT NULL DEFAULT '',  -- '' or A1..C2
    visibility  TEXT        NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playlists_user_idx ON playlists (user_id);
CREATE INDEX playlists_public_idx ON playlists (updated_at DESC) WHERE visibility = 'public';

CREATE TABLE playlist_topics (
    playlist_id BIGINT  NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    topic_id    BIGINT  NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, topic_id)
);
CREATE INDEX playlist_topics_topic_idx ON playlist_topics (topic_id);

CREATE TABLE playlist_follows (
    playlist_id BIGINT      NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, user_id)
);
CREATE INDEX playlist_follows_user_idx ON playlist_follows (user_id);

-- "Listen -> Write" (dictation) attempts, graded on the server.
CREATE TABLE dictation_attempts (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id    BIGINT           NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    answer     TEXT             NOT NULL,
    score      DOUBLE PRECISION NOT NULL,
    passed     BOOLEAN          NOT NULL,
    created_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX dictation_attempts_item_user_idx ON dictation_attempts (item_id, user_id);
