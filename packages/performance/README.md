# @llm-bench/performance

A response benchmark and measurement collector for latency, usage, cost, and
throughput. The built-in case asks for the exact sentinel response `READY`.

`PerformanceBenchmark` uses one warmup followed by five measured repetitions.
`collectPerformanceSamples()` preserves every raw sample and computes
sample-counted sum, mean, p50, p95, and population variance aggregates from
measured samples only. Missing TTFT, usage, or cost remains `null` with an
explicit reason; it is never converted to zero.

```ts
import {
  collectPerformanceSamples,
  PerformanceBenchmark,
} from "@llm-bench/performance";

const benchmark = new PerformanceBenchmark();
const report = await collectPerformanceSamples({
  sample: async () => ({
    durationMs: 100,
    ttftMs: null,
    inputTokens: 5,
    outputTokens: 1,
    costUsd: null,
  }),
});
```
