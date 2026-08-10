-- Scenarios must record the subject characteristics that convened the panel.
--
-- `convene()` scores domains against relevance predicates, and half of those predicates are
-- `subject_characteristic` kind (Appendix B §B.2.4: "Bonded primary structure implicates
-- polymers and adhesives. Any electronic emission implicates spectrum."). Without this
-- column a persisted scenario cannot be re-convened — the panel could not be reproduced from
-- the record, which defeats §B.6 step 6's point that the scenario and panel "become the
-- charter everything downstream traces to."
--
-- A charter you cannot re-derive is a claim, not a record.

ALTER TABLE scenarios ADD COLUMN subject_characteristics TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN scenarios.subject_characteristics IS
  'Controlled-vocabulary tags describing the subject. Matched exactly against relevance predicates of kind subject_characteristic (Appendix B section B.2.4).';
