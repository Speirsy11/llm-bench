# @llm-bench/performance

A response benchmark and measurement collector for latency, usage, cost, and
throughput. Harness/process duration remains distinct from provider request
duration when the latter is observable. The built-in case asks for the exact
sentinel response `READY`.

`PerformanceBenchmark` uses one warmup followed by five measured repetitions.
`collectPerformanceSamples()` preserves every raw sample and computes
sample-counted sum, mean, p50, p95, and population variance aggregates from
measured samples only. Sample counts must be non-negative integers, and at least
one measured sample is required. Missing provider duration, TTFT, usage, or cost
remains `null` with an explicit reason; it is never converted to zero.

```ts
import {
  collectPerformanceSamples,
  PerformanceBenchmark,
} from "@llm-bench/performance";

const benchmark = new PerformanceBenchmark();
const report = await collectPerformanceSamples({
  sample: async () => ({
    durationMs: 100,
    providerDurationMs: 80,
    ttftMs: null,
    inputTokens: 5,
    outputTokens: 1,
    costUsd: null,
  }),
});
```
