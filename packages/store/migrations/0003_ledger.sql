-- The ledger. Append-only, hash-chained, never updated.
--
-- The entire hidden-profile countermeasure rests on Phase 1 outputs existing before
-- Phase 2 opens (Appendix D §D.2.5). If that ordering is not cryptographically
-- demonstrable, the architecture's central claim is unauditable.

CREATE TABLE ledger (
  seq          BIGSERIAL PRIMARY KEY,
  event_id     UUID NOT NULL,
  phase        SMALLINT NOT NULL,
  actor        TEXT NOT NULL,                  -- persona_id | 'human:<name>' | 'system'
  -- Closed enumeration drawn from the Scribe's instrumentation list (Appendix B §B.13).
  -- An open-ended column would let a later milestone quietly stop recording one of them.
  kind         TEXT NOT NULL CHECK (kind IN (
                 'persona_output','retrieval','claim_traceback','position_change',
                 'challenge_outcome','confidence_assignment','gap_declaration',
                 'abandoned_path','human_intervention','routing_event',
                 'specificity_override','phase_transition','panel_proposal',
                 'panel_approval','finding_discarded')),
  payload      JSONB NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ledger_hash_uq ON ledger(hash);
CREATE INDEX ledger_event_seq_idx ON ledger(event_id, seq);

REVOKE UPDATE, DELETE ON ledger FROM PUBLIC;

-- REVOKE is necessary but not sufficient: it does not constrain the table owner, which is
-- the role the application connects as. The trigger is what actually makes the table
-- append-only for us, and it is the thing a tamper test can demonstrate.
CREATE OR REPLACE FUNCTION ledger_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on seq % is not permitted',
    TG_OP, COALESCE(OLD.seq, NEW.seq)
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

CREATE TRIGGER ledger_no_truncate
  BEFORE TRUNCATE ON ledger
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_is_append_only();
