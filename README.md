# MAE Panel Engine

Reference implementation of the scenario-driven adversary emulation architecture described
in *No Blind Spots*, Appendices A through E.

## The central engineering principle

**The charter is a validator, not a prompt.**

The book says things like "the charter prohibits attribution above Considered on physical
evidence alone." If that constraint lives only in a system prompt it is not a constraint. It
is a request, and it will be honoured most of the time and violated exactly when the model is
most confident, which is when it matters.

Every constraint is enforced at the output boundary by deterministic code that rejects
non-conforming output and returns it for revision. The persona proposes; the validator
disposes.

That has a direct consequence for build order: the deterministic core is built and
exhaustively tested **before any model is called**. Convening, charter validation,
composition arithmetic, and correlation adjustment are pure functions with no LLM dependency.
They can be tested to a standard model-dependent code never reaches, and they are where
correctness actually lives.

## What is built

| | Status |
|---|---|
| **M0** Scaffold, hash-chained ledger, schema, migrations | Built |
| **M1** Registry, relevance predicates, scenario-driven convening | Built |
| **M2** Field ingest with mandatory grading, situational retrieval | Built |
| **M3** Charter validator, CH001–CH012 | Built |
| Phase 0 persistence: scenario, panel, event, and the two-signature approval gate | Built |
| Synthetic field content, identified and enforced end to end | Built |
| Chain composition bounds (§E.3) and effective sample size (§E.4) | Built |
| **M4–M10** Persona runtime, phases, challenge, metrics, governance, UI | Not started |

No model has been called. Nothing in `packages/core` can call one — see below.

## Layout

```
packages/
  core/     pure logic. no I/O, no network, no LLM
    ledger/       canonicalJson, computeHash, verifyChain
    registry/     archetype map (§B.2.3), seed domains, relevance predicates
    convening/    convene()
    charter/      validators, specificity trace, claim classification, repair reducer
    composition/  chain bounds (§E.3)
    metrics/      effective sample size and agreement disclosure (§E.4)
    retrieval/    Admiralty grading, pure hybrid ranking
  store/    Postgres access, hash-chained ledger append, migrations
  fields/   ingest, source grading, situational retrieval
  cli/      operator commands
fixtures/
  scenarios/  the three worked scenarios from §B.2.5, with their stated panels
  charter/    deliberately non-conforming findings, with the codes each must produce
```

`packages/core` may import nothing but itself and `node:crypto`. This is enforced twice: an
ESLint rule, and `core-purity.test.ts`, which walks the sources independently — a lint rule
can be disabled inline, and this invariant should cost a red test to break.

## Running it

```bash
pnpm install
pnpm lint && pnpm typecheck
pnpm test                          # core suite: no database, no network, no API keys

docker compose up -d               # Postgres 16 + pgvector
export DATABASE_URL=postgres://mae:mae@localhost:5432/mae
pnpm migrate
pnpm test:db                       # store and fields integration

pnpm seed:registry --archetypes latent_physical,procedural_interpretive
pnpm cli panel:propose --scenario fixtures/scenarios/composite-qualification.json
pnpm cli charter:check
pnpm cli ledger:verify --event <uuid>
```

Database-backed tests skip cleanly when `DATABASE_URL` is unset. CI runs them against a
pgvector service container.

## The two tests that matter most

**Spine reassertion.** `convene` must produce **no** `immediate_observable` domain at full
depth for the bonded-composite qualification scenario. A construct with a cyber spine treats
every archetype as "cyber, but slower", and the symptom is a cyber persona at full depth on a
structures review. If that test fails, the convening mechanism has acquired a home discipline.

**Ledger tamper detection.** A mutated payload must be caught at the exact `seq`. The entire
hidden-profile countermeasure rests on Phase 1 outputs existing before Phase 2 opens; if that
ordering is not cryptographically demonstrable, the architecture's central claim is
unauditable.

## What this does not solve

Stated plainly, because the code should not imply otherwise:

- **Field curation is the dominant cost and is not a software problem.** The ingest pipeline
  is a week. Curating a defensible metallurgy field is months of expert time. Nothing has
  been curated. `fixtures/fields/` holds content invented to exercise the engine, marked
  `synthetic` in the schema, forced to Admiralty F/6, and capped by charter rule CH012 — see
  `fixtures/fields/README.md`. **Building that content did not curate a field**, and a run
  over it shows the machinery works, not that any finding it produces is true.
- **Correlation estimation requires ground truth.** Until a probe set exists, `rho` is
  unmeasured and panel agreement is uninterpretable. The disclosure says so rather than
  defaulting to zero.
- **Specificity extraction has false positives.** The human override path exists, and every
  override is logged.
- **The verification circularity is untouched.** Chapter Twenty-One applies: where the
  organization has no competent validator, this software can enforce structure and
  traceability but cannot establish correctness. The auditability affordances are built
  because they are what a non-specialist validator can actually check.

See [RECONCILE.md](./RECONCILE.md) for every place the implementation departs from the
implementation plan, or where the book is ambiguous and a decision was required.
