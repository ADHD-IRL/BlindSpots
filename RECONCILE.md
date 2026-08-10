# Reconciliation notes

Places where the implementation departs from `MAE_Engine_Implementation_Plan.md`, or where
*No Blind Spots* is ambiguous or internally inconsistent and a decision had to be made.

Each entry states what the source says, what the code does, and why. Nothing here is a
silent deviation — every one is also commented at the point of implementation.

---

## 1. Convening: relevance predicates select domains, not archetype

**Plan (§M1):** "Map consequence classes to implicated archetypes. Within each archetype,
score domains by matched relevance predicates." Archetype is a hard filter.

**Problem:** that algorithm cannot reproduce the book's own worked panels. §B.2.5 Scenario 1
has consequence classes `physical_failure_in_service` and `safety_event`. Per the §B.2.3
table those implicate Latent-Physical, Attributive-Contested, and Governed-Consequence. But
the stated panel puts **supply chain provenance at full depth** and **legal at screening
depth**, both Procedural-Interpretive. §B.2.4's own worked examples say the same thing:
"Foreign-jurisdiction suppliers at any tier implicates provenance and legal."

**Decision:** relevance predicates do the convening. A domain matching no predicate scores
zero and is omitted regardless of archetype. Archetype implication is recorded per slot,
gates Governed-Consequence, and raises an advisory warning when a full-depth domain comes
from outside the implicated set.

**Why this is safe:** the property the architecture actually depends on is §C.4 step six —
"a domain registered against everything will always be convened, which reintroduces a spine
through the back door" — and that property lives in the predicates, not in the archetype
filter. The spine-reassertion regression test still passes: no `immediate_observable` domain
reaches full depth on the composite qualification scenario.

`packages/core/src/convening/convene.ts`

---

## 2. Governed-Consequence is never auto-convened

**Source:** §B.2.3 maps `safety_event` to Latent-Physical **and** Governed-Consequence, yet
§B.2.5 Scenario 1 carries `safety_event` and its panel contains no such persona.

**Decision:** `convene` strips Governed-Consequence into a `GovernanceGate` notice and never
emits a slot for it. Per §B.14, §C.2.4, and §C.8 stage 6, those domains instantiate only in
a cleared enclave, under specific program need, with human authority approval — convening
surfaces the requirement rather than satisfying it. The gate is reported rather than dropped
so the human lead adjudicating the panel sees the omission.

The implementation plan does not mention this at all; following it literally would have
produced panels the book contradicts.

---

## 3. §B.2.5's prose contradicts its own enumerated panels

**Source:** "Three panels. Minimal overlap. Only counterintelligence appears in more than
one, and for structurally different reasons each time."

**Problem:** Scenario 2's panel lists geopolitical, and Scenario 3's panel lists geopolitical.
Counterintelligence is not the only domain appearing twice.

**Decision:** the enumerated panels are the ground truth an implementation must reproduce,
so the golden tests assert them. The recurrence test allows counterintelligence and
geopolitical, and separately asserts that **no** domain appears in all three, which is the
property the sentence was reaching for.

`packages/core/test/convening.test.ts`

---

## 4. Panel size band is advisory

**Source:** §B.6, "Panel size in practice runs eight to fourteen at full depth."

**Problem:** the book's own illustrative panels run six (Scenario 2) and seven (Scenarios 1
and 3), below the band it states.

**Decision:** `convene` emits a warning, never an error, and §B.6 step 6 puts a human in the
adjudication seat regardless. A test asserts the warning does not change the slots.

---

## 5. `event_id` added to the ledger hash preimage

**Plan (§2.3):** `hash = sha256(prev_hash || canonical_json(payload) || actor || kind || phase)`.

**Problem:** every event's chain roots at the same genesis `prev_hash`, so two events opening
with the same actor, kind, phase and payload produce byte-identical hashes and collide on the
`ledger_hash_uq` index. Worse, an entry could be moved from one event to another without
invalidating its hash — precisely the relocation the chain exists to make impossible.

**Decision:** `hash = sha256(event_id || prev_hash || canonical_json(payload) || actor || kind || phase)`,
with fields joined by U+001F so content cannot shift across a field boundary undetected.

`packages/core/src/ledger/hash.ts`

---

## 6. `seq` is verified as strictly increasing, not contiguous

**Plan (§2.3):** `seq BIGSERIAL PRIMARY KEY`, allocated globally across all events.

**Consequence:** an event's entries are strictly increasing but not contiguous, because other
events interleave. Contiguity is not an invariant and cannot be checked. Excision within an
event is caught by the prev_hash walk, which is the real integrity mechanism; `seq` is a
cheap ordering cross-check layered on top.

`packages/core/src/ledger/verify.ts`

---

## 7. Ledger immutability needs a trigger, not only REVOKE

**Plan (§2.3):** `REVOKE UPDATE, DELETE ON ledger FROM PUBLIC`.

**Problem:** REVOKE does not constrain the table owner, which is the role the application
connects as. The migration adds a `BEFORE UPDATE OR DELETE OR TRUNCATE` trigger that raises.
A store test disables the trigger, tampers, and confirms the hash chain still catches it —
because the trigger stops the application, not someone with direct database access.

`packages/store/migrations/0003_ledger.sql`

---

## 8. Scope inclusion is checked against a declared field, not inferred from prose

**Plan (§M3 rule 6):** "Statement subject must fall within `scope_inclusions`."

**Problem:** deciding whether a prose statement's subject "falls within" a snake_case registry
term requires matching that produces both false positives and false negatives at a rate that
would make the validator untrusted — and a validator personas learn to work around enforces
nothing.

**Decision:** the finding declares which inclusion it addresses (`addressesInclusion`), and
CH007 fires when the declared inclusion is not one the persona owns. The exclusion half of
the rule is unchanged and does match against the statement, because routing on a false
positive is recoverable — it goes to a named target — while a missed exclusion is not.

This is also the discipline §D.2.5 relies on: explicit scope declarations are what let
unshared contributions arrive with a reason to be credited.

`packages/core/src/charter/validate.ts`

---

## 9. Rules added to M3 that the plan places elsewhere or omits

| Code | Source | Plan's treatment |
|---|---|---|
| `CH001` basis-named requirement for `plausible` | §B.5.2 "Plausible — Any, basis named" | Omitted; the plan covers only the assessed/likely tiers |
| `CH006` status ceiling for curated as well as provisional | §C.5.3 promotion ladder | Plan wires only the provisional case |
| `CH008` base rate and PPV for behavioural indicators | §C.3.1 | Absent from the plan |
| `CH009` no optimistic grade propagation | §E.2.2 | Absent from the plan |
| `CH010` named-individual prohibition | §C.3.4, §C.9, §E.8.6 | Plan defers to M10 |
| `CH011` prohibited mechanism output | §C.2.4 | Plan defers to M10 |

`CH010` and `CH011` are deterministic checks on emitted text with terminating routing. They
cost little and belong at the output boundary with the rest of the validator; deferring them
to M10 would mean every intervening milestone runs without them.

---

## 10. Challenger and Devil's Advocate are distinct roles

**Plan:** treats challenge as one role (M7).

**Source:** §B.4 and §D.12 separate them — the Challenger attacks findings in Phase 4, the
Devil's Advocate attacks the *framing* during Phase 0 convening (§B.6 step 5), "because
framing errors dominate and nothing else catches them."

**Status:** not yet built (both are M7/Phase-0 work), but recorded here so the distinction is
not lost when it is. `convene`'s warnings are written as input to the Devil's Advocate review.

---

## 11. Schema tightened against the appendices

- `scenarios.lifecycle_stage` is CHECK-constrained to the seven stages in §B.2.2 rather than
  free text.
- `panel_members.persona_class` added, from §B.4. The Phase 1 cross-domain read exception for
  reflexive personas (§B.7.1, §C.3.2) gates on this, not on the hardcoded set of domain ids
  the plan's M5 assumes.
- `ledger.kind` is a closed enumeration of the Scribe's §B.13 instrumentation list. An
  open-ended column would let a later milestone quietly stop recording one of them.
- `findings` carries `corroborating_findings`, `sampling_rate`, and `false_negative_rate`,
  which the charter validator requires but the plan's DDL omits.

---

## Not resolved here

Per §6 of the implementation plan and §E.9, these are flagged rather than solved:

- **Field curation is the dominant cost and is not a software problem.** The ingest pipeline
  is built; a defensible metallurgy field is months of expert time. The pipeline is not the
  capability.
- **`rho` is unmeasured** until a ground-truth probe set exists. `discloseAgreement` reports
  `unmeasured` as a first-class state and says agreement is uninterpretable — it does not
  default to zero, which would silently claim independence.
- **Specificity extraction has false positives.** The human override path exists and every
  override is logged to the ledger.
- **The verification circularity is untouched.** The auditability affordances are built
  (source grades surfaced, specifics traced, gaps enumerated) because they are what a
  non-specialist validator can actually check.
