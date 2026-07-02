# @llm-bench/process-harness

The shared subprocess boundary for native harness adapters. It starts one
detached process group in a small allowlisted environment, writes the request
prompt to stdin, collects bounded JSONL output, redacts configured secret
values, and terminates the whole process group when cancellation or the
deadline fires.

`JsonlProcessHarnessAdapter` is the extension point. Concrete harnesses provide
their command, native-event parser, and result normalizer; lifecycle and safety
behavior stay in this package. `NodeProcessRunner` is public so fixture
executables can contract-test lifecycle behavior without invoking a paid model.

The package supports macOS and Linux. Windows process behavior is outside the
v1 product boundary.
