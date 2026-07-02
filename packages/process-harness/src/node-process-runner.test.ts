import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NodeProcessRunner,
  terminateProcessGroup,
} from "./node-process-runner";

describe("NodeProcessRunner", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("redacts secrets even when a process splits them across output chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdout.write("api-");
setTimeout(() => {
  process.stdout.write("secret\\n");
  process.stderr.write("api-");
  setTimeout(() => process.stderr.end("secret\\n"), 10);
}, 10);
`,
    );
    await chmod(executable, 0o700);

    const result = await new NodeProcessRunner().run({
      argv: [process.execPath, executable],
      cwd: root,
      env: {},
      maxOutputBytes: 1_024,
      redact: ["api-secret"],
    });

    expect(result.stdoutLines).toEqual(["[REDACTED]"]);
    expect(result.stderr).toBe("[REDACTED]\n");
    expect(JSON.stringify(result)).not.toContain("api-secret");
  });

  it("stops a process whose combined output exceeds the byte limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdout.write("x".repeat(128));
setInterval(() => {}, 1_000);
`,
    );
    await chmod(executable, 0o700);

    await expect(
      new NodeProcessRunner().run({
        argv: [process.execPath, executable],
        cwd: root,
        env: {},
        maxOutputBytes: 32,
      }),
    ).rejects.toMatchObject({
      name: "ProcessOutputLimitError",
      limitBytes: 32,
    });
  });

  it("terminates the process group when the run is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    const grandchild = join(root, "grandchild.mjs");
    const marker = join(root, "grandchild-finished");
    await writeFile(
      grandchild,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

setTimeout(() => writeFileSync(process.argv[2], "bad"), 350);
`,
    );
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: "ignore" });
setInterval(() => {}, 1_000);
`,
    );
    await chmod(executable, 0o700);
    const controller = new AbortController();
    const running = new NodeProcessRunner().run({
      argv: [process.execPath, executable, grandchild, marker],
      cwd: root,
      env: {},
      signal: controller.signal,
      maxOutputBytes: 1_024,
    });
    setTimeout(() => controller.abort(), 75);

    await expect(running).resolves.toMatchObject({ cancelled: true });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await expect(
      import("node:fs/promises").then(({ access }) => access(marker)),
    ).rejects.toThrow();
  });

  it("does not start useful work when cancellation was already requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
setInterval(() => {}, 1_000);
`,
    );
    await chmod(executable, 0o700);
    const controller = new AbortController();
    controller.abort();

    await expect(
      new NodeProcessRunner().run({
        argv: [process.execPath, executable],
        cwd: root,
        env: {},
        signal: controller.signal,
        maxOutputBytes: 1_024,
      }),
    ).resolves.toMatchObject({ cancelled: true });
  });

  it("force-kills a cancelled process group that ignores graceful termination", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    const ready = join(root, "ready");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(ready)}, "ready");
setTimeout(() => process.exit(0), 1_500);
`,
    );
    await chmod(executable, 0o700);
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = new NodeProcessRunner({ killGraceMs: 50 }).run({
      argv: [process.execPath, executable],
      cwd: root,
      env: {},
      signal: controller.signal,
      maxOutputBytes: 1_024,
    });
    await waitForFile(ready);
    controller.abort();

    await expect(running).resolves.toMatchObject({
      cancelled: true,
      signal: "SIGKILL",
    });
    expect(Date.now() - startedAt).toBeLessThan(750);
  });

  it("rejects executable launch errors after redacting their message", async () => {
    const root = await mkdtemp(join(tmpdir(), "node-process-runner-"));
    roots.push(root);

    await expect(
      new NodeProcessRunner().run({
        argv: [join(root, "missing-api-secret")],
        cwd: root,
        env: {},
        stdin: "",
        maxOutputBytes: 1_024,
        redact: ["api-secret", ""],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("missing-[REDACTED]");
      const cause = (error as Error & { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toContain("missing-[REDACTED]");
      expect((cause as Error).message).not.toContain("api-secret");
      return true;
    });
  });

  it("falls back to the direct child when a process group cannot be signalled", () => {
    const directKill = vi.fn(() => true);
    const groupKill = vi.fn(() => {
      throw new Error("already exited");
    });

    terminateProcessGroup({ pid: 123, kill: directKill }, "SIGTERM", groupKill);
    terminateProcessGroup(
      { pid: undefined, kill: directKill },
      "SIGTERM",
      groupKill,
    );

    expect(groupKill).toHaveBeenCalledOnce();
    expect(directKill).toHaveBeenCalledTimes(2);
  });

  it("uses the process group without a direct fallback when signalling succeeds", () => {
    const directKill = vi.fn(() => true);
    const groupKill = vi.fn(() => true as const);

    terminateProcessGroup({ pid: 123, kill: directKill }, "SIGTERM", groupKill);

    expect(groupKill).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(directKill).not.toHaveBeenCalled();
  });
});

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Fixture did not become ready: ${path}`);
}
