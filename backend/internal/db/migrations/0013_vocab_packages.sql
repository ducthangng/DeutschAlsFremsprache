-- Vocabulary Pocket packages: the learner's own groups of words ("A2 Kapitel 3",
-- "Arbeit"…). A word belongs to at most one package; deleting a package keeps
-- its words, unfiled.
CREATE TABLE vocab_packages (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL CHECK (name <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vocab_packages_user_name_idx ON vocab_packages (user_id, lower(name));

ALTER TABLE vocab_entries ADD COLUMN package_id BIGINT REFERENCES vocab_packages (id) ON DELETE SET NULL;
CREATE INDEX vocab_entries_package_idx ON vocab_entries (package_id);
