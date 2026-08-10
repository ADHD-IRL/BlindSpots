-- Chains. Implementation plan §2.5; step attributes from Appendix B §B.8 Phase 3.

CREATE TABLE chains (
  id            UUID PRIMARY KEY,
  event_id      UUID NOT NULL,
  adversary_id  TEXT NOT NULL,
  objective     TEXT NOT NULL,
  status        TEXT NOT NULL
                CHECK (status IN ('proposed','survived','revised','rejected')),
  reject_reason TEXT,
  -- Both bounds, always (Appendix E §E.3). floor = product under independence,
  -- ceiling = weakest step. Reporting a single number is not honest, and reporting only
  -- the minimum systematically overstates chain feasibility, which is the direction that
  -- wastes remediation budget.
  bound_floor   REAL CHECK (bound_floor BETWEEN 0 AND 1),
  bound_ceiling REAL CHECK (bound_ceiling BETWEEN 0 AND 1),
  -- Where between the bounds the estimate sits, and why. Required from the Synthesist:
  -- steps drawing on the same capability and access push toward the ceiling; steps
  -- requiring genuinely distinct capabilities push toward the floor.
  shared_enabler_note TEXT,
  CHECK (bound_floor IS NULL OR bound_ceiling IS NULL OR bound_floor <= bound_ceiling)
);

CREATE TABLE chain_steps (
  chain_id      UUID NOT NULL REFERENCES chains(id),
  ordinal       SMALLINT NOT NULL,
  domain_id     TEXT NOT NULL REFERENCES domains(id),
  archetype     archetype NOT NULL,
  -- Every step traces to a named finding from a named persona. Steps that cannot be
  -- backed are not admitted (§B.8 Phase 3). NOT NULL is the schema half of that rule;
  -- the insert path rejects unbacked steps before reaching the database.
  backing_finding UUID NOT NULL REFERENCES findings(id),
  feasibility   REAL NOT NULL CHECK (feasibility BETWEEN 0 AND 1),
  -- Heterogeneous by archetype and deliberately so: latency and reversibility are null for
  -- immediate_observable steps and load-bearing for latent_physical ones. A chain mixing
  -- archetypes has steps whose effects are separated by years and whose attributability
  -- differs by orders of magnitude, and the notation has to carry that rather than
  -- flattening it.
  latency_desc  TEXT,
  trigger_cond  TEXT,
  reversibility TEXT,
  observability TEXT,
  attribution_strength TEXT NOT NULL,
  PRIMARY KEY (chain_id, ordinal)
);
