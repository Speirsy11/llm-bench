import { describe, expect, it } from "vitest";

import { ProcessExitError } from "./errors";

describe("ProcessExitError", () => {
  it("describes exit codes with and without stderr", () => {
    expect(new ProcessExitError(7, null, "provider failed\n").message).toBe(
      "Process exited with code 7. provider failed",
    );
    expect(new ProcessExitError(1, null, "").message).toBe(
      "Process exited with code 1.",
    );
  });

  it("describes signal termination even when a signal is unavailable", () => {
    expect(new ProcessExitError(null, "SIGTERM", "").message).toBe(
      "Process terminated by SIGTERM.",
    );
    expect(new ProcessExitError(null, null, "").message).toBe(
      "Process terminated by an unknown signal.",
    );
  });
});
