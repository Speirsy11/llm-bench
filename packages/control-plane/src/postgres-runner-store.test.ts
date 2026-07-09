import { describe, expect, it } from "vitest";

import { PostgresRunnerJobStore } from "./postgres-runner-store";

type RunnerStoreDatabase = ConstructorParameters<
  typeof PostgresRunnerJobStore
>[0];

describe("PostgresRunnerJobStore", () => {
  it("rejects a completed job when the terminal result cannot be read back", async () => {
    const returningRows: unknown[][] = [[{ id: "attempt-1" }], []];
    const limitRows: unknown[][] = [
      [
        {
          id: "job-1",
          benchmarkId: "repository-repair",
          benchmarkVersion: "1.0.0",
        },
      ],
      [],
    ];
    const builder = (): Record<string, unknown> => ({
      set: builder,
      values: builder,
      where: builder,
      from: builder,
      onConflictDoNothing: builder,
      returning: () => Promise.resolve(returningRows.shift() ?? []),
      limit: () => Promise.resolve(limitRows.shift() ?? []),
    });
    const transaction = {
      update: builder,
      insert: builder,
      select: builder,
    };
    const db = {
      transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as RunnerStoreDatabase;
    const terminal = {
      attemptId: "attempt-1",
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [],
      error: null,
    } satisfies NonNullable<Parameters<PostgresRunnerJobStore["complete"]>[3]>;

    await expect(
      new PostgresRunnerJobStore(db).complete(
        "attempt-1",
        "job-1",
        "completed",
        terminal,
      ),
    ).rejects.toThrow("Completed job result was not persisted.");
  });
});
