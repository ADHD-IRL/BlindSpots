-- Fields. Implementation plan §2.6; grading discipline from Appendix E §E.2.

CREATE EXTENSION IF NOT EXISTS vector;

-- Admiralty source reliability, A through F. Assigned by a human at curation time, never
-- inferred: "grading is a required input, not inferred" and ingest fails without it.
CREATE TABLE field_sources (
  id            UUID PRIMARY KEY,
  field_id      TEXT NOT NULL,
  uri           TEXT NOT NULL,
  title         TEXT,
  reliability   CHAR(1) NOT NULL CHECK (reliability IN ('A','B','C','D','E','F')),
  graded_by     TEXT NOT NULL,
  graded_at     TIMESTAMPTZ NOT NULL,
  corpus_cutoff DATE
);

CREATE INDEX field_sources_field_idx ON field_sources(field_id);

-- Information credibility, 1 through 6. The axes are deliberately independent: a
-- completely reliable source can report information that is doubtful, and collapsing the
-- two into one confidence figure destroys the distinction (§E.2).
CREATE TABLE field_chunks (
  id            UUID PRIMARY KEY,
  source_id     UUID NOT NULL REFERENCES field_sources(id),
  field_id      TEXT NOT NULL,
  text          TEXT NOT NULL,
  credibility   SMALLINT NOT NULL CHECK (credibility BETWEEN 1 AND 6),
  -- Retrieval is situational, not document-based (Appendix A §A.12 step four): index by
  -- situation type, cue pattern, adversary technique, system characteristic, failure mode.
  -- The question is not "what documents mention this term" but "what does the field know
  -- about situations that look like this one."
  situation_tags TEXT[] NOT NULL,
  embedding     vector(1536)
);

CREATE INDEX field_chunks_embedding_idx ON field_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX field_chunks_tags_idx ON field_chunks USING gin (situation_tags);
CREATE INDEX field_chunks_field_idx ON field_chunks(field_id);
