# Model cassettes

Recorded and authored model responses, replayed by `RecordedTransport` so the persona runtime
can be built and tested with no API key and no network.

**Everything currently in this directory is `authored`.** A person wrote these responses.
No model produced any of them. That is the same distinction `fixtures/fields/` draws between
curated expertise and synthetic content, applied to the other side of the model call.

## The three provenances

| value | meaning |
|---|---|
| `live` | an `AnthropicTransport` call, right now |
| `replayed` | a model produced this text once, and it was captured |
| `authored` | no model has ever produced this text |

`provenance` is not a field a cassette can set. Stored responses are **rejected at load if
they carry one** — a file asserting `provenance: "live"` would otherwise replay as a live
result forever. It is derived from the cassette's declared `origin` at the moment of
delivery, and it travels on every `ModelResponse` to the ledger.

## What is enforced, and where

1. **`origin` is declared, never inferred.** `assertCassette` rejects a cassette without one.
   There is no safe default: guessing `recorded` presents an invention as model output,
   guessing `authored` throws away a real capture.
2. **`authored` requires a `note`.** What the invented response exercises. The counterpart of
   `gradedBy` on a field source.
3. **The key is recomputed on load.** `key = sha256(canonical_json(resolved_request))`. Edit a
   cassette's request and it stops loading, rather than silently answering a prompt it was
   never given.
4. **A miss throws.** `CassetteMissError`. No fall-through to a live call, no placeholder, no
   plausible invention. A transport that fabricates on a miss produces a green suite that has
   tested nothing, invisibly, exactly when the prompt changed under it.
5. **Replays cannot be re-recorded.** `RecordingTransport` throws on anything whose
   provenance is not `live`, so an authored response can never be laundered into a capture.

## Working with them

```bash
pnpm cli cassette:list                 # what is here and how it replays
node --experimental-strip-types packages/runtime/src/bin/author-cassettes.ts
```

The authoring script is committed because the key over a request is exact. When M4 builds the
real persona prompt these cassettes will stop matching — that is intended — and the script is
how they come back.

## Recording real ones

```ts
import { AnthropicTransport } from '@mae/runtime/transport/anthropic.ts';
import { RecordingTransport, fileCassetteSink } from '@mae/runtime';

const transport = new RecordingTransport(
  new AnthropicTransport(),                    // needs ANTHROPIC_API_KEY
  fileCassetteSink('fixtures/cassettes'),
  { capturedBy: 'human:<name>' },
);
```

Captures land as `origin: "recorded"` and replay as `replayed`. Delete the authored cassette
for a purpose once a real recording of it exists; do not edit an authored file into a
recorded one, because the response text would still be the invented one.

## What a green test run here does and does not show

It shows that the request is built, the response is parsed, the charter validator runs over
it, and the repair reducer disposes of what it returns — including on a refusal, where there
is no content at all.

It shows nothing about what a model would say.
