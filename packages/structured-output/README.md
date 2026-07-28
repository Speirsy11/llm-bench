# @llm-bench/structured-output

A deterministic response benchmark for strict structured-output compliance.
The built-in case asks for one exact customer record and grades the raw response
without invoking another model.

`StructuredOutputBenchmark` requires `response_generation`, runs three
repetitions by default, and reports `schema_compliance` as a binary ratio.
Responses fail when JSON is invalid, required fields are missing, values or
types differ, or additional properties are present.

```ts
import { StructuredOutputBenchmark } from "@llm-bench/structured-output";

const benchmark = new StructuredOutputBenchmark();
const [testCase] = benchmark.cases();
const observations = benchmark.grade(
  testCase.id,
  '{"name":"Ada Lovelace","age":36,"active":true}',
);
```
