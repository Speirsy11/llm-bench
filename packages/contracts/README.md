# @llm-bench/contracts

The provider-neutral vocabulary shared by benchmarks, harnesses, runners, and
the control plane. This package contains **no** process spawning, HTTP calls,
persistence, or concrete providers — only the v1 abstract classes and the Zod
schemas for serialized contracts.

## What it defines

- **Typed metrics** — `MetricDefinition` declares a `kind`, `unit`, and ranking
  `direction`; observations carry `null` for missing data.
- **Capabilities** — the fixed set a harness advertises and a benchmark
  requires, plus `evaluateCompatibility` for typed failures.
- **Manifests** — `BenchmarkManifest`, `HarnessManifest`, model routes,
  toolsets, and limits.
- **Workloads** — `ResponseCase` (defaults to 3 repetitions) and `AgenticTask`
  (defaults to 1).
- **Events** — discriminated `BenchmarkEvent` and `Failure` unions, checkpoints,
  and artifacts.
- **Abstract classes** — `Benchmark` / `ResponseBenchmark` / `AgenticBenchmark`,
  `HarnessAdapter` / `ProcessHarnessAdapter`, and
  `OpenAICompatibleModelProvider`.
- **Wire protocol** — a versioned `WireEnvelope` that rejects unknown major
  versions and unknown fields.

## Examples

Reject an unsupported benchmark/harness combination before a paid call:

```ts
import { evaluateCompatibility } from "@llm-bench/contracts";

evaluateCompatibility(["workspaces", "shell"], ["response_generation"]);
// → { compatible: false, missing: ["workspaces", "shell"] }
```

Validate a serialized message and refuse a future protocol major:

```ts
import { WireEnvelopeSchema } from "@llm-bench/contracts";

WireEnvelopeSchema.safeParse({
  protocolVersion: "2.0.0",
  kind: "benchmark_manifest",
  payload: {},
}).success;
// → false
```

Implement a benchmark by extending the abstract contract:

```ts
import type { ResponseCase } from "@llm-bench/contracts";
import { ResponseBenchmark } from "@llm-bench/contracts";

class StructuredOutputBenchmark extends ResponseBenchmark {
  cases(): ResponseCase[] {
    return [{ id: "json-extract", prompt: "Return JSON.", repetitions: 3 }];
  }
}
```
