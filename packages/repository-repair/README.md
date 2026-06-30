# @llm-bench/repository-repair

The v1 TypeScript repository-repair fixture and its deterministic harnesses,
run through [`@llm-bench/runner-engine`](../runner-engine). This is the primary
agentic benchmark's first task: a deliberately broken `clamp` function the
harness must fix.

## What it provides

- **`repairScenario()`** — a runnable `RepairScenario`: the `ClampRepairBenchmark`
  manifest, the agentic task, a `prepare` that writes the broken project plus a
  visible specification, and the hidden behavioural tests.
- **`knownPatchHarness()`** — the canonical harness applying the known good patch.
- **`createPatchHarness(source)`** — a harness that writes arbitrary source over
  the module under repair (used to model incomplete patches).
- **`noChangeHarness()`** — a harness that inspects but changes nothing.
- Source constants: `BROKEN_SOURCE`, `KNOWN_PATCH`, `PARTIAL_PATCH`.

## Hidden grading is real

The hidden tests are withheld until grading and then **execute the repaired
module directly** with Node's native module loader. The pass ratio therefore
reflects actual behaviour, not a harness self-report:

- the broken fixture passes only the in-range case (1/3);
- the known patch passes every case (3/3);
- the incomplete patch that clamps the lower bound only is detected (2/3).

## Example

```ts
import {
  knownPatchHarness,
  repairScenario,
} from "@llm-bench/repository-repair";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

const result = await executeAgenticTask({
  jobId,
  scenario: repairScenario(),
  harness: knownPatchHarness(),
  limits,
  workspaceRoot,
  artifactStore: new FileArtifactStore(artifactDir),
  eventSpool: new JsonlEventSpool(spoolPath),
});

result.grade?.ratio; // 1 — every hidden test passes
```
