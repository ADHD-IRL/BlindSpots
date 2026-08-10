-- Registry: domains, relevance predicates, joints.
-- Implementation plan §2.1, with archetype semantics from Appendix B §B.3.

CREATE TYPE archetype AS ENUM (
  'immediate_observable',
  'latent_physical',
  'attributive_contested',
  'procedural_interpretive',
  'anticipatory_unvalidated',
  'governed_consequence'
);

CREATE TABLE domains (
  id                TEXT PRIMARY KEY,          -- 'materials.metallurgy'
  display_name      TEXT NOT NULL,
  archetype         archetype NOT NULL,
  parent_domain     TEXT REFERENCES domains(id),
  scope_inclusions  TEXT[] NOT NULL,
  scope_exclusions  JSONB NOT NULL,            -- [{topic, route_to}]
  -- Appendix C §C.5.3 promotion ladder. Each rung carries a confidence ceiling, enforced
  -- in code by the charter validator (CH006): provisional caps at Plausible, curated at
  -- Likely, registered has the full range.
  status            TEXT NOT NULL
                    CHECK (status IN ('provisional','curated','registered')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Archetype-plural domains are separate rows sharing a parent (Appendix B §B.3.1).
-- A single persona holding all three would apply whichever archetype's confidence
-- discipline is loosest, which is the failure mode the structure exists to prevent.
--   supply_chain.provenance    -> procedural_interpretive
--   supply_chain.vendor_intent -> attributive_contested
--   supply_chain.authenticity  -> latent_physical

CREATE TABLE relevance_predicates (
  id            BIGSERIAL PRIMARY KEY,
  domain_id     TEXT NOT NULL REFERENCES domains(id),
  kind          TEXT NOT NULL CHECK (kind IN ('consequence_class','subject_characteristic')),
  value         TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  UNIQUE (domain_id, kind, value)
);

CREATE INDEX relevance_predicates_domain_idx ON relevance_predicates(domain_id);

CREATE TABLE joints (
  domain_a       TEXT NOT NULL REFERENCES domains(id),
  domain_b       TEXT NOT NULL REFERENCES domains(id),
  productivity   REAL NOT NULL DEFAULT 0.0,   -- learned prior, Appendix C §C.6.3
  observations   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_a, domain_b),
  CHECK (domain_a < domain_b)
);
