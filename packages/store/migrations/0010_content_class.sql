-- Synthetic content is identified in the data, and the identification is load-bearing.
--
-- Real field curation is expert months (Appendix C §C.6.4), and none has happened. To
-- exercise the machinery before it has, the engine needs content that is unmistakably not
-- curated expertise — and "unmistakably" cannot mean a note in a README, because the thing
-- that reads the field is code, and the risk is precisely that synthetic material is later
-- mistaken for the real thing.
--
-- So `content_class` is a column, it propagates to every retrieved chunk, and the charter
-- validator caps any finding that could rest on it. A label nobody enforces would be exactly
-- the "plausible-sounding text generator with a database attached" the implementation plan
-- warns about.

ALTER TABLE field_sources
  ADD COLUMN content_class TEXT NOT NULL DEFAULT 'curated'
  CHECK (content_class IN ('curated', 'synthetic'));

-- Existing rows predate the distinction and were ingested as ordinary content. Drop the
-- default afterwards so every future insert has to say which it is: a source that does not
-- declare its class is the one case we must not guess about.
ALTER TABLE field_sources ALTER COLUMN content_class DROP DEFAULT;

-- Synthetic content has no source to be reliable and nothing independent to corroborate it.
-- The Admiralty scale already has the honest codes for that: F ("cannot be judged") on
-- reliability, 6 on credibility. Grading synthetic material any higher would launder an
-- invention into evidence, which is the failure §E.2.2 describes in its other direction.
ALTER TABLE field_sources
  ADD CONSTRAINT field_sources_synthetic_cannot_be_judged
  CHECK (content_class <> 'synthetic' OR reliability = 'F');

CREATE OR REPLACE FUNCTION synthetic_chunk_cannot_be_judged() RETURNS TRIGGER AS $$
DECLARE
  class TEXT;
BEGIN
  SELECT content_class INTO class FROM field_sources WHERE id = NEW.source_id;
  IF class = 'synthetic' AND NEW.credibility <> 6 THEN
    RAISE EXCEPTION
      'synthetic chunk must carry credibility 6 (cannot be judged), not %', NEW.credibility
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER field_chunks_synthetic_credibility
  BEFORE INSERT OR UPDATE ON field_chunks
  FOR EACH ROW EXECUTE FUNCTION synthetic_chunk_cannot_be_judged();

CREATE INDEX field_sources_content_class_idx ON field_sources(content_class);

COMMENT ON COLUMN field_sources.content_class IS
  'curated = real material graded by a human at curation time. synthetic = invented for exercising the engine; forced to F/6 and capped by charter rule CH012.';

-- ---------------------------------------------------------------------------------------
-- The marking survives to the finding, and from there to the output package.
--
-- Precedent is §C.5.2's provisional persona: "output_marking: PROVISIONAL through to final
-- package". A caveat that is dropped somewhere between the evidence and the report is not a
-- caveat.
-- ---------------------------------------------------------------------------------------

ALTER TABLE findings
  ADD COLUMN synthetic_basis BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN findings.synthetic_basis IS
  'True when the persona could have drawn on synthetic content. Carried to the output package; see charter rule CH012.';
