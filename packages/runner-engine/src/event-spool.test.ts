import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BenchmarkEvent } from "@llm-bench/contracts";

import { JsonlEventSpool } from "./event-spool";

describe("JsonlEventSpool", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function spoolPath(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "spool-"));
    dirs.push(dir);
    return path.join(dir, "events.jsonl");
  }

  const started: BenchmarkEvent = {
    type: "job_started",
    at: "2026-06-30T12:00:00.000Z",
    jobId: "job-1",
  };

  it("appends events and reads them back in order", async () => {
    const spool = new JsonlEventSpool(await spoolPath());
    const completed: BenchmarkEvent = {
      type: "case_completed",
      at: "2026-06-30T12:00:01.000Z",
      caseId: "case-1",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
    };

    await spool.append(started);
    await spool.append(completed);

    expect(await spool.events()).toEqual([started, completed]);
  });

  it("writes one JSON object per line", async () => {
    const file = await spoolPath();
    const spool = new JsonlEventSpool(file);

    await spool.append(started);
    await spool.append(started);

    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("rejects an event that violates the contract schema", async () => {
    const spool = new JsonlEventSpool(await spoolPath());

    await expect(
      spool.append({ type: "unknown_event" } as unknown as BenchmarkEvent),
    ).rejects.toThrow();
  });

  it("rejects a spool file containing a malformed line", async () => {
    const file = await spoolPath();
    await writeFile(file, '{"type":"job_started"}\n', "utf8");
    const spool = new JsonlEventSpool(file);

    await expect(spool.events()).rejects.toThrow();
  });

  it("returns no events for an empty or absent spool", async () => {
    const spool = new JsonlEventSpool(await spoolPath());

    expect(await spool.events()).toEqual([]);
  });

  it("surfaces a non-ENOENT read error instead of reporting no events", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spool-"));
    dirs.push(dir);
    // Pointing the spool at a directory makes readFile fail with EISDIR.
    const spool = new JsonlEventSpool(dir);

    await expect(spool.events()).rejects.toThrow();
  });
});
