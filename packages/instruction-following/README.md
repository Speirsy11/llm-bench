# @llm-bench/instruction-following

A deterministic response benchmark for exact instruction compliance. The
built-in case requests exactly three bullet lines, each beginning with `- ` and
containing no more than eight words.

`InstructionFollowingBenchmark` requires `response_generation`, runs three
repetitions by default, and reports `instruction_compliance` as a binary ratio.
The grader checks the raw response locally and rejects extra lines, malformed
bullets, overlong bullets, and carriage-return line endings.

```ts
import { InstructionFollowingBenchmark } from "@llm-bench/instruction-following";

const benchmark = new InstructionFollowingBenchmark();
const [testCase] = benchmark.cases();
const observations = benchmark.grade(
  testCase.id,
  "- Pin every dependency\\n- Record the environment\\n- Repeat each measurement",
);
```
