# @llm-bench/repository-repair

The deterministic repository-repair benchmark corpus, run through
[`@llm-bench/runner-engine`](../runner-engine). The corpus contains six small,
offline repair fixtures: three TypeScript tasks and three Python tasks.

## Fixtures

| Fixture                    | Language   | Failure shape                              |
| -------------------------- | ---------- | ------------------------------------------ |
| `typescript-clamp-bounds`  | TypeScript | Boundary logic                             |
| `typescript-async-cache`   | TypeScript | Async control flow and in-flight caching   |
| `typescript-state-reducer` | TypeScript | State mutation                             |
| `python-parse-duration`    | Python     | Parsing and unit conversion                |
| `python-api-boundary`      | Python     | DTO sanitization across an API boundary    |
| `python-resource-cleanup`  | Python     | File-handle cleanup on success and failure |

Every fixture includes broken source, a known-good patch, a plausible incomplete
patch, visible instructions, hidden graders, runtime requirements, a fixture
content hash, and a grader hash. Hidden graders are not written into the
workspace during execution.

## Public API

- `repairFixtures()` returns the deterministic fixture catalog.
- `repairFixture(id)` returns one public fixture manifest.
- `repairScenario(id?)` returns a runnable `RepairScenario`; omitting `id` keeps
  the original clamp fixture as the compatibility default.
- `knownPatchHarness(id?)` applies the known-good patch for a fixture.
- `createPatchHarness(id, source)` writes arbitrary source over a fixture module.
  `createPatchHarness(source)` remains supported for the default clamp fixture.
- `noChangeHarness(id?)` inspects a fixture without repairing it.
- `repairCorpusSample(id, grade)` stamps a result sample with fixture and grader
  hashes.
- `summarizeRepairCorpus(samples)` emits overall and per-language pass ratios
  plus raw sample counts.

## Hidden grading

Hidden tests execute repaired modules directly. TypeScript fixtures load local
CommonJS modules with Node. Python fixtures run `python3` (or `LLMBENCH_PYTHON`)
with the workspace on `PYTHONPATH`. The corpus is network independent.

The pass ratio reflects actual behavior, not a harness self-report. Known
patches pass every hidden test. Plausible incomplete patches are detected by at
least one hidden grader per fixture.

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
  scenario: repairScenario("python-resource-cleanup"),
  harness: knownPatchHarness("python-resource-cleanup"),
  limits,
  workspaceRoot,
  artifactStore: new FileArtifactStore(artifactDir),
  eventSpool: new JsonlEventSpool(spoolPath),
});

result.grade?.ratio; // 1
```
