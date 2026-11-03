-- CEFR level of a speaking topic, shown on its card. Older topics have none
-- ('') until their owner picks one.
ALTER TABLE topics ADD COLUMN level TEXT NOT NULL DEFAULT ''
    CHECK (level IN ('', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'));
