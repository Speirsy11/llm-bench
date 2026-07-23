import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DurableEventBuffer } from "./event-buffer";

describe("DurableEventBuffer", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("retains events across network failure and replays them in sequence", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-events-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const buffer = new DurableEventBuffer(path);
    await buffer.append({
      type: "job_started",
      at: "2026-07-01T10:00:00.000Z",
      jobId: "job-1",
    });
    await buffer.append({
      type: "case_completed",
      at: "2026-07-01T10:00:01.000Z",
      caseId: "case-1",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
    });

    await expect(
      buffer.flush(() => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
    expect(await buffer.pending()).toHaveLength(2);

    const replayed: number[] = [];
    await buffer.flush((events) => {
      replayed.push(...events.map(({ sequence }) => sequence));
      return Promise.resolve({ throughSequence: 1 });
    });

    expect(replayed).toEqual([0, 1]);
    expect(await buffer.pending()).toEqual([]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const third = await buffer.append({
      type: "job_started",
      at: "2026-07-01T10:00:02.000Z",
      jobId: "job-2",
    });
    const fourth = await buffer.append({
      type: "job_started",
      at: "2026-07-01T10:00:03.000Z",
      jobId: "job-2",
    });
    expect([third.sequence, fourth.sequence]).toEqual([2, 3]);
    await buffer.flush(() => Promise.resolve({ throughSequence: 2 }));
    expect(await buffer.pending()).toMatchObject([{ sequence: 3 }]);
  });

  it("surfaces malformed or unreadable spool files and skips an empty flush", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-events-"));
    roots.push(root);
    const buffer = new DurableEventBuffer(join(root, "events.jsonl"));
    let sent = false;
    await buffer.flush(() => {
      sent = true;
      return Promise.resolve({ throughSequence: 0 });
    });
    expect(sent).toBe(false);

    const directoryBuffer = new DurableEventBuffer(root);
    await expect(directoryBuffer.pending()).rejects.toThrow();
  });

  it("rejects malformed or unreadable sequence cursors and recovers after a failed mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-events-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const buffer = new DurableEventBuffer(path);

    await writeFile(`${path}.sequence`, "invalid\n");
    await expect(
      buffer.append({
        type: "job_started",
        at: "2026-07-01T10:00:00.000Z",
        jobId: "job-1",
      }),
    ).rejects.toThrow("sequence file is invalid");
    await writeFile(`${path}.sequence`, "-1\n");
    await expect(
      buffer.append({
        type: "job_started",
        at: "2026-07-01T10:00:01.000Z",
        jobId: "job-1",
      }),
    ).rejects.toThrow("sequence file is invalid");
    await rm(`${path}.sequence`);
    await mkdir(`${path}.sequence`);
    await expect(
      buffer.append({
        type: "job_started",
        at: "2026-07-01T10:00:02.000Z",
        jobId: "job-1",
      }),
    ).rejects.toThrow();
  });

  it("continues a legacy event spool that predates the sequence cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-events-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    await writeFile(
      path,
      `${JSON.stringify({
        sequence: 4,
        event: {
          type: "job_started",
          at: "2026-07-01T10:00:00.000Z",
          jobId: "job-1",
        },
      })}\n`,
    );

    await expect(
      new DurableEventBuffer(path).append({
        type: "case_completed",
        at: "2026-07-01T10:00:01.000Z",
        caseId: "case-1",
        observations: [],
      }),
    ).resolves.toMatchObject({ sequence: 5 });
  });

  it.each(["", "4-partial"])(
    "recovers an intact event spool when the sequence cursor contains %p",
    async (corruptCursor) => {
      const root = await mkdtemp(join(tmpdir(), "llm-bench-events-"));
      roots.push(root);
      const path = join(root, "events.jsonl");
      await writeFile(
        path,
        `${JSON.stringify({
          sequence: 4,
          event: {
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: "job-1",
          },
        })}\n`,
      );
      await writeFile(`${path}.sequence`, corruptCursor);

      await expect(
        new DurableEventBuffer(path).append({
          type: "case_completed",
          at: "2026-07-01T10:00:01.000Z",
          caseId: "case-1",
          observations: [],
        }),
      ).resolves.toMatchObject({ sequence: 5 });
    },
  );
});
