-- Remember which embedder made each knowledge-base vector, so documents can be re-embedded after a switch.
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedder TEXT;
