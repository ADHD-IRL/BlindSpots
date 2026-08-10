# Synthetic field content

**Nothing in this directory is curated expertise. All of it was invented to exercise the
engine, and none of it should be relied on for any statement about the world.**

That warning is here for people. The enforcement is elsewhere, because a warning in a README
is not a constraint — it is a request, and the risk this guards against is precisely that
synthetic material is later mistaken for the real thing by someone who never read this file.

## How the identification is actually enforced

| Layer | Mechanism |
|---|---|
| Schema | `field_sources.content_class` is NOT NULL with no default, so a source cannot be ingested without saying which it is (migration `0010`). |
| Schema | A synthetic source must carry Admiralty **F**, and its chunks must carry **6** — "cannot be judged" on both axes. A CHECK constraint and a trigger enforce it. |
| Ingest | `assertGraded` rejects a synthetic source that claims better grades, before anything is written. |
| Retrieval | `contentClass` rides on every `GradedChunk` all the way to the persona. |
| Charter | **CH012** caps any finding whose retrieval set contains synthetic material at `considered`, and requires the finding to declare `syntheticBasis`. |
| Output | `findings.synthetic_basis` carries the marking to the output package, following §C.5.2's precedent that a provisional persona's output is marked `PROVISIONAL` through to the final package. |

The cap is `considered` because §B.5.2 defines that term as "raised for awareness,
insufficient basis", which is exactly what a finding derived from invented material is.

Synthetic content is **not low-grade evidence**. It is not evidence. F/6 is the honest coding,
and it is why the grades cannot be raised.

## Why this exists at all

Appendix C §C.6.4 is blunt that field curation is the binding constraint and that a
defensible field is months of expert elicitation. None has happened. Without *something* in a
field, retrieval returns nothing and Phase 1 cannot produce a finding at all, so the engine
could not be run end to end before the expensive part is funded.

So: run it on content that is unmistakably marked, capped everywhere it touches, and cheap to
throw away. **The pipeline is not the capability** — building this content does not
constitute curating a field, and a run over it demonstrates that the machinery works, not
that any finding it produces is true.

## Fail-closed on mixing

CH012 tests the **retrieval set**, not the chunks a finding cites. If synthetic material was
in front of the persona there is no way to demonstrate it went unused, so a field must not mix
classes. Keep synthetic content in its own `field_id` (these use a `.synthetic` suffix) and
retire the whole field when real curation replaces it.

## Replacing this with real content

1. Curate per Appendix A §A.12, including Critical Decision Method elicitation.
2. Ingest with `contentClass: 'curated'` and honest Admiralty grades.
3. Point the persona's `field_binding` at the curated field id.
4. Delete the synthetic field. Do not migrate chunks across — the grades would have to be
   rewritten, and rewriting a grade is the one operation the whole two-axis discipline exists
   to prevent.
