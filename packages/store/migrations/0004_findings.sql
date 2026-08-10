-- Findings and the outputs the protocol makes mandatory rather than optional.
-- Implementation plan §2.4; confidence vocabulary from Appendix B §B.5.2.

CREATE TYPE confidence AS ENUM ('assessed','likely','plausible','considered','gap');
CREATE TYPE validity  AS ENUM ('high','moderate','low');

CREATE TABLE findings (
  id                UUID PRIMARY KEY,
  event_id          UUID NOT NULL,
  persona_id        TEXT NOT NULL,
  phase             SMALLINT NOT NULL,
  statement         TEXT NOT NULL,
  confidence        confidence NOT NULL,
  validity_tier     validity NOT NULL,
  -- Appendix B §B.5.2 permits Plausible at any validity tier but only with the basis
  -- named. Enforced at the output boundary by CH001; the NOT NULL here is the floor.
  basis             TEXT NOT NULL,
  -- Both Admiralty axes carried through, never collapsed to a scalar (Appendix E §E.2.2).
  source_grades     JSONB NOT NULL,            -- [{chunk_id, reliability, credibility}]
  -- Attribution above the archetype cap requires named corroborating findings from OTHER
  -- personas (§B.5.2, §C.2.5). Self-corroboration is rejected by CH002.
  corroborating_findings UUID[] NOT NULL DEFAULT '{}',
  -- Detection claims must state both or the claim is not admissible (§C.2.6).
  sampling_rate     REAL,
  false_negative_rate REAL,
  provisional       BOOLEAN NOT NULL DEFAULT false,
  superseded_by     UUID REFERENCES findings(id),
  ledger_seq        BIGINT NOT NULL REFERENCES ledger(seq)
);

CREATE INDEX findings_event_idx ON findings(event_id);

-- Appendix C §C.2.7: the gap map is usually this archetype's most valuable single output —
-- a map of where the program is trusting documents it cannot check.
CREATE TABLE gap_declarations (
  id            UUID PRIMARY KEY,
  event_id      UUID NOT NULL,
  persona_id    TEXT NOT NULL,
  record_named  TEXT NOT NULL,
  holder        TEXT,                            -- supplier tier, org
  claim_blocked TEXT NOT NULL,
  obtainable    BOOLEAN,
  ledger_seq    BIGINT NOT NULL REFERENCES ledger(seq)
);

-- Appendix A §A.12 step two: expert search-space pruning is invisible in the final report,
-- and it is precisely the pruning function the specification requires be captured.
CREATE TABLE abandoned_paths (
  id          UUID PRIMARY KEY,
  event_id    UUID NOT NULL,
  persona_id  TEXT NOT NULL,
  approach    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  ledger_seq  BIGINT NOT NULL REFERENCES ledger(seq)
);

-- Appendix B §B.7.3: a persona may not adopt a peer's position without naming the specific
-- evidence that changed its assessment. An empty array is recorded, not rejected, because
-- the evidence-free convergence RATE is the diagnostic, not any single change.
CREATE TABLE position_changes (
  id             UUID PRIMARY KEY,
  event_id       UUID NOT NULL,
  persona_id     TEXT NOT NULL,
  from_finding   UUID REFERENCES findings(id),
  to_finding     UUID REFERENCES findings(id),
  cited_evidence JSONB NOT NULL,               -- [] means evidence-free
  peer_persona   TEXT,
  ledger_seq     BIGINT NOT NULL REFERENCES ledger(seq)
);

-- Appendix B §B.7.4: the minority position is frequently where the value sits. An output
-- presenting only consensus has discarded the hardest-won part of the analysis.
CREATE TABLE dissents (
  id                 UUID PRIMARY KEY,
  event_id           UUID NOT NULL,
  holder_persona     TEXT NOT NULL,
  position           TEXT NOT NULL,
  panel_reason       TEXT NOT NULL,
  resolving_evidence TEXT NOT NULL,
  obtainable         BOOLEAN NOT NULL,
  ledger_seq         BIGINT NOT NULL REFERENCES ledger(seq)
);
