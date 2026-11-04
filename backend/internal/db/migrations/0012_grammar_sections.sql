-- A part of a grammar set can be added or written again later: the words the
-- set was built from are kept for that, and "pending" names the part being
-- generated ('' = none; one at a time per set).
ALTER TABLE grammar_sets ADD COLUMN vocab_level TEXT  NOT NULL DEFAULT '';
ALTER TABLE grammar_sets ADD COLUMN vocabulary  JSONB NOT NULL DEFAULT '[]';
ALTER TABLE grammar_sets ADD COLUMN pending     TEXT  NOT NULL DEFAULT '';
