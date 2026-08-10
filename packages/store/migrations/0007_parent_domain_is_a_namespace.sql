-- `parent_domain` is a grouping label, not a reference to another domain.
--
-- The self-referencing foreign key from 0001 forced every parent to exist as a `domains`
-- row, which meant inventing an archetype for it — and `domains.archetype` is NOT NULL.
-- For `materials` and `legal` that would be arbitrary. For `supply_chain` it would be
-- actively wrong: Appendix B §B.3.1 exists precisely because supply chain spans three
-- archetypes, and instantiating it as one row with one archetype is the flattening the
-- plural split prevents. "A single persona holding all three will apply whichever
-- archetype's confidence discipline is loosest, which is the failure mode this whole
-- structure exists to prevent."
--
-- So the parent is a namespace: supply_chain.provenance, supply_chain.vendor_intent and
-- supply_chain.authenticity share the label and nothing else. Dropping the FK is what lets
-- the column carry the grouping the registry actually declares, instead of being silently
-- discarded at seed time.

ALTER TABLE domains DROP CONSTRAINT domains_parent_domain_fkey;

-- A namespace still has to be a namespace: a domain cannot be its own parent, and the label
-- must be a prefix of the ids it groups, so the grouping is derivable rather than asserted.
ALTER TABLE domains
  ADD CONSTRAINT domains_parent_is_namespace
  CHECK (
    parent_domain IS NULL
    OR (parent_domain <> id AND id LIKE parent_domain || '.%')
  );

CREATE INDEX domains_parent_idx ON domains(parent_domain);

COMMENT ON COLUMN domains.parent_domain IS
  'Grouping namespace, not a domain reference. Archetype-plural domains (Appendix B section B.3.1) share a parent and hold different archetypes.';
