import { describe, expect, it } from "vitest";

import { runDaemonLoop } from "./daemon";

describe("runDaemonLoop", () => {
  it("keeps the daemon alive after a transient transport failure", async () => {
    let heartbeats = 0;
    let workerRuns = 0;
    let sleeps = 0;
    const errors: unknown[] = [];

    await runDaemonLoop({
      heartbeat: () => {
        heartbeats += 1;
        return heartbeats === 1
          ? Promise.reject(new Error("network unavailable"))
          : Promise.resolve();
      },
      runOnce: () => {
        workerRuns += 1;
        return Promise.resolve();
      },
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
      stopping: () => heartbeats >= 2,
      onError: (error) => errors.push(error),
      intervalMs: 2000,
    });

    expect({ heartbeats, workerRuns, sleeps }).toEqual({
      heartbeats: 2,
      workerRuns: 1,
      sleeps: 1,
    });
    expect(errors).toEqual([new Error("network unavailable")]);
  });
});
