# @llm-bench/runner-engine

The local agentic execution engine. It proves one repository-repair task end to
end **without a server**: it prepares an ephemeral workspace, runs a
deterministic harness under a combined cancel/deadline signal, injects hidden
grading only after the harness finishes, records typed observations and the
final diff as an artifact, and deletes the workspace.

This package contains **no** network control plane, database, real model calls,
or native agent CLIs. A harness is any object satisfying the `FixtureHarness`
contract; concrete model-backed harnesses arrive in later epics.

## What it provides

- **`Workspace`** — an ephemeral directory whose every access is contained to
  the root. Absolute paths, `..` traversal, and symlink escapes are rejected.
- **`executeAgenticTask`** — the public execution entrypoint. Returns a typed
  `ExecutionResult` with a status (`completed` / `failed` / `cancelled` /
  `timed_out`), an independent hidden-test grade, the final diff, the stored
  diff artifact, timing, and a verified cleanup flag.
- **`JsonlEventSpool`** — append-only JSONL event log validated against the
  contract schema on the way in and out; malformed records are rejected.
- **`FileArtifactStore`** — content-addressed artifact storage keyed by SHA-256.
- **`captureDiff` / `renderDiffText`** — workspace diff capture for honest
  evidence of what the harness changed.
- **`gradeHiddenTests`** — runs hidden behavioural tests and reports the pass
  ratio, independent of anything the harness self-reports.

## Grading boundary

Hidden tests are passed to the engine, not written into the workspace, so they
are absent while the harness runs and execute only during grading. A repair that
produces non-importable code scores zero rather than crashing the engine.

## Cancellation and timeouts

Cancellation (`cancel`) and the deadline (`deadline`, defaulting to the
configured duration limit) are `AbortSignal`s combined for the harness. When
either fires, the run terminates with `cancelled` or `timed_out`, the partial
diff is still captured, and the primary metric is recorded as missing (`null`)
rather than fabricated.

## Example

```ts
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

const result = await executeAgenticTask({
  jobId,
  scenario, // a RepairScenario: benchmark, task, prepare(), hiddenTests
  harness, // a FixtureHarness: repair({ workspace, signal })
  limits, // Limits from @llm-bench/contracts
  workspaceRoot: os.tmpdir(),
  artifactStore: new FileArtifactStore(artifactDir),
  eventSpool: new JsonlEventSpool(spoolPath),
});

result.status; // "completed"
result.grade?.ratio; // independent hidden-test pass ratio
result.cleanedUp; // true — workspace deleted
```
