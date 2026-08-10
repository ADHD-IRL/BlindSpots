-- Scenario and panel. Implementation plan §2.2, schema from Appendix B §B.2.2.

CREATE TABLE scenarios (
  id                  UUID PRIMARY KEY,
  subject             TEXT NOT NULL,
  -- Constrained rather than free text: Appendix B §B.2.2 enumerates the stages, and
  -- convening derives subject characteristics from this field.
  lifecycle_stage     TEXT NOT NULL
                      CHECK (lifecycle_stage IN ('requirements','design','qualification',
                                                 'production','fielded','sustainment','disposal')),
  mission_function    TEXT NOT NULL,
  consequence_classes TEXT[] NOT NULL,
  -- "The field that prevents an assessment from being an academic exercise" (§B.2.2).
  -- An assessment that does not name the decision it informs, and the date that decision
  -- is made, produces findings that arrive after they can be acted on.
  informing_decision  TEXT NOT NULL,
  decision_date       DATE,
  adversary_set       TEXT[] NOT NULL,
  access_constraints  TEXT,
  classification      TEXT NOT NULL,
  exclusions          JSONB NOT NULL,
  authored_by         TEXT NOT NULL,
  approved_by         TEXT,                    -- NULL until human approval
  approved_at         TIMESTAMPTZ,
  CHECK (array_length(consequence_classes, 1) >= 1)
);

CREATE TABLE panels (
  id            UUID PRIMARY KEY,
  scenario_id   UUID NOT NULL REFERENCES scenarios(id),
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ
);

CREATE TABLE panel_members (
  panel_id    UUID NOT NULL REFERENCES panels(id),
  persona_id  TEXT NOT NULL,
  domain_id   TEXT NOT NULL REFERENCES domains(id),
  depth       TEXT NOT NULL CHECK (depth IN ('full','screening')),
  -- Appendix B §B.4 persona classes. Reflexive personas (counterintelligence, OPSEC) get
  -- cross-domain read scope in Phase 1 as the documented exception to §B.7.1; that gate
  -- reads this column rather than an ad hoc flag or a hardcoded set of domain ids.
  persona_class TEXT NOT NULL
                CHECK (persona_class IN ('domain','adversary','process','reflexive')),
  model_id    TEXT NOT NULL,                   -- for correlation tracking, §B.7.2
  provisional BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (panel_id, persona_id)
);
