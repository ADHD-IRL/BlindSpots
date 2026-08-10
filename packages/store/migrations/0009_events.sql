-- The assessment event: what `event_id` has been referring to all along.
--
-- `ledger`, `findings`, `gap_declarations`, `abandoned_paths`, `position_changes`,
-- `dissents` and `chains` all key on `event_id`, and until now nothing created one and no
-- constraint tied them together. The column named a thing that did not exist.
--
-- An event is one run of the §B.8 workflow over one scenario with one panel. It is created
-- in Phase 0 alongside the panel, and it is where the phase state machine lives.

CREATE TABLE events (
  id           UUID PRIMARY KEY,
  scenario_id  UUID NOT NULL REFERENCES scenarios(id),
  panel_id     UUID NOT NULL REFERENCES panels(id),
  -- §B.8: Phase 0 convening through Phase 7 output and provenance.
  phase        SMALLINT NOT NULL DEFAULT 0 CHECK (phase BETWEEN 0 AND 7),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

CREATE INDEX events_scenario_idx ON events(scenario_id);
CREATE INDEX events_panel_idx ON events(panel_id);

-- Backfill before constraining, so this migration is safe on a database that already has
-- ledger history. Orphaned event ids get a placeholder scenario and panel rather than being
-- dropped: the ledger is append-only, and discarding entries to satisfy a new constraint
-- would be exactly the tampering the chain exists to prevent.
DO $$
DECLARE
  orphan_count INT;
  placeholder_scenario UUID := '00000000-0000-4000-8000-000000000000';
  placeholder_panel    UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  SELECT count(DISTINCT l.event_id) INTO orphan_count
    FROM ledger l LEFT JOIN events e ON e.id = l.event_id
   WHERE e.id IS NULL;

  IF orphan_count > 0 THEN
    INSERT INTO scenarios (
      id, subject, lifecycle_stage, mission_function, consequence_classes,
      informing_decision, adversary_set, classification, exclusions, authored_by,
      subject_characteristics
    ) VALUES (
      placeholder_scenario,
      'Pre-events ledger history (backfilled)',
      'design',
      'Placeholder for ledger entries written before the events table existed',
      ARRAY['program_disruption'],
      'None. Backfill only.',
      ARRAY['none'],
      'UNCLASSIFIED',
      '[]'::jsonb,
      'system:migration_0009',
      ARRAY[]::text[]
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO panels (id, scenario_id)
      VALUES (placeholder_panel, placeholder_scenario)
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO events (id, scenario_id, panel_id, phase)
      SELECT DISTINCT l.event_id, placeholder_scenario, placeholder_panel, 0
        FROM ledger l LEFT JOIN events e ON e.id = l.event_id
       WHERE e.id IS NULL
      ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Backfilled % event(s) from existing ledger history.', orphan_count;
  END IF;
END $$;

ALTER TABLE ledger            ADD CONSTRAINT ledger_event_fkey            FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE findings          ADD CONSTRAINT findings_event_fkey          FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE gap_declarations  ADD CONSTRAINT gap_declarations_event_fkey  FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE abandoned_paths   ADD CONSTRAINT abandoned_paths_event_fkey   FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE position_changes  ADD CONSTRAINT position_changes_event_fkey  FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE dissents          ADD CONSTRAINT dissents_event_fkey          FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE chains            ADD CONSTRAINT chains_event_fkey            FOREIGN KEY (event_id) REFERENCES events(id);

-- ---------------------------------------------------------------------------------------
-- An approved panel is frozen.
--
-- §B.6 step 6: "The scenario and panel composition become the charter everything downstream
-- traces to." Editing the composition after signature silently invalidates every traceback
-- that cites it, and a signature that can be moved is not a signature. Same reasoning as the
-- ledger's append-only trigger: the rule belongs in the database, not in a convention.
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION panel_members_frozen_when_approved() RETURNS TRIGGER AS $$
DECLARE
  target UUID := COALESCE(OLD.panel_id, NEW.panel_id);
  signed_by TEXT;
BEGIN
  SELECT approved_by INTO signed_by FROM panels WHERE id = target;
  IF signed_by IS NOT NULL THEN
    RAISE EXCEPTION 'panel % was approved by % and its composition is frozen', target, signed_by
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER panel_members_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON panel_members
  FOR EACH ROW EXECUTE FUNCTION panel_members_frozen_when_approved();

CREATE OR REPLACE FUNCTION approval_is_write_once() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.approved_by IS NOT NULL AND
     (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at)
  THEN
    RAISE EXCEPTION 'approval is write-once: % was already approved by %', TG_TABLE_NAME, OLD.approved_by
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER panels_approval_write_once
  BEFORE UPDATE ON panels
  FOR EACH ROW EXECUTE FUNCTION approval_is_write_once();

CREATE TRIGGER scenarios_approval_write_once
  BEFORE UPDATE ON scenarios
  FOR EACH ROW EXECUTE FUNCTION approval_is_write_once();

-- Both signatures must name a human. §B.11 lists scenario authorship and panel composition
-- approval as separate non-delegable decisions: "accountability attaches to a named human."
ALTER TABLE panels
  ADD CONSTRAINT panels_approval_is_complete
  CHECK ((approved_by IS NULL) = (approved_at IS NULL));

ALTER TABLE scenarios
  ADD CONSTRAINT scenarios_approval_is_complete
  CHECK ((approved_by IS NULL) = (approved_at IS NULL));
