-- Profile pictures (a key in media storage, like topic covers).
ALTER TABLE users ADD COLUMN avatar_key TEXT NOT NULL DEFAULT '';
