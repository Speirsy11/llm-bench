import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HiddenTest } from "./grader";
import { gradeHiddenTests } from "./grader";
import { Workspace } from "./workspace";

describe("gradeHiddenTests", () => {
  const opened: Workspace[] = [];
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((workspace) => workspace.cleanup()));
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function workspace(): Promise<Workspace> {
    const created = await Workspace.create(tmpdir());
    opened.push(created);
    return created;
  }

  function test(id: string, result: boolean): HiddenTest {
    return {
      id,
      runtime: "node",
      source: result ? "assert.equal(2 + 2, 4);" : 'throw new Error("failed");',
    };
  }

  it("reports a full ratio when every hidden test passes", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      test("b", true),
    ]);

    expect(grade).toEqual({
      total: 2,
      passed: 2,
      ratio: 1,
      passedIds: ["a", "b"],
      failedIds: [],
    });
  });

  it("executes repaired modules outside the long-lived runner process", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model-authored.cjs",
      "module.exports = { pid: process.pid };\n",
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "isolated-process",
        runtime: "node",
        source: `const loaded = require(path.join(workspaceRoot, "model-authored.cjs"));
assert.notEqual(loaded.pid, ${process.pid});`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 1,
      passedIds: ["isolated-process"],
      failedIds: [],
    });
  });

  it("does not let repaired Node modules forge a passing grader result", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model-authored.cjs",
      `JSON.stringify = () => '{"passed":true}';
module.exports = {};`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "node-result-forgery",
        runtime: "node",
        source: `require(path.join(workspaceRoot, "model-authored.cjs"));
assert.fail("the hidden assertion must fail");`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      passedIds: [],
      failedIds: ["node-result-forgery"],
    });
  });

  it("does not trust a Node result written before model-authored code exits", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model-authored.cjs",
      `require("node:fs").writeFileSync(
  require("node:path").join(require("node:path").dirname(process.argv[1]), "result.json"),
  '{"passed":true}',
);
process.exit(0);`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "node-direct-result-forgery",
        runtime: "node",
        source: `require(path.join(workspaceRoot, "model-authored.cjs"));`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      passedIds: [],
      failedIds: ["node-direct-result-forgery"],
    });
  });

  it("does not let Node shutdown hooks replace a failing grader result", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model-authored.cjs",
      `const fs = require("node:fs");
const path = require("node:path");
process.on("beforeExit", () => {
  fs.writeFileSync(path.join(path.dirname(process.argv[1]), "result.json"), '{"passed":true}');
});
module.exports = {};`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "node-shutdown-forgery",
        runtime: "node",
        source: `require(path.join(workspaceRoot, "model-authored.cjs"));
assert.fail("the hidden assertion must fail");`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      failedIds: ["node-shutdown-forgery"],
    });
  });

  it("reports an independent partial ratio for an incomplete repair", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      test("b", false),
      test("c", true),
      test("d", false),
    ]);

    // 2 of 4 is an independent literal, not recomputed from the code.
    expect(grade.ratio).toBe(0.5);
    expect(grade.passedIds).toEqual(["a", "c"]);
    expect(grade.failedIds).toEqual(["b", "d"]);
  });

  it("counts a hidden test that throws as failed rather than crashing", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      {
        id: "explodes",
        runtime: "node",
        source: 'throw new Error("module did not import");',
      },
    ]);

    expect(grade.passed).toBe(1);
    expect(grade.failedIds).toEqual(["explodes"]);
  });

  it("fails a grader that exceeds its bounded output allowance", async () => {
    const grade = await gradeHiddenTests(
      await workspace(),
      [
        {
          id: "noisy",
          runtime: "node",
          source: 'process.stdout.write("x".repeat(4096));',
        },
      ],
      { maxOutputBytes: 128 },
    );

    expect(grade).toMatchObject({ passed: 0, failedIds: ["noisy"] });
  });

  it("bounds the authenticated result channel before parsing it", async () => {
    const grade = await gradeHiddenTests(
      await workspace(),
      [test("oversized-result", true)],
      { maxResultBytes: 1 },
    );

    expect(grade).toMatchObject({
      passed: 0,
      failedIds: ["oversized-result"],
    });
  });

  it("fails and terminates a grader that exceeds its timeout", async () => {
    const grade = await gradeHiddenTests(
      await workspace(),
      [
        {
          id: "slow",
          runtime: "node",
          source: "await new Promise((resolve) => setTimeout(resolve, 100));",
        },
      ],
      { timeoutMs: 10 },
    );

    expect(grade).toMatchObject({ passed: 0, failedIds: ["slow"] });
  });

  it("terminates grading when cancellation is requested", async () => {
    const cancellation = new AbortController();
    const pending = gradeHiddenTests(
      await workspace(),
      [
        {
          id: "cancelled",
          runtime: "node",
          source: "await new Promise((resolve) => setTimeout(resolve, 100));",
        },
      ],
      { signal: cancellation.signal },
    );
    setTimeout(() => cancellation.abort(), 10);

    await expect(pending).resolves.toMatchObject({
      passed: 0,
      failedIds: ["cancelled"],
    });
  });

  it("honours an abort that lands during grader startup", async () => {
    const openedWorkspace = await workspace();
    const cancellation = new AbortController();
    let abortedReads = 0;
    const addAbortListener = cancellation.signal.addEventListener.bind(
      cancellation.signal,
    );
    const removeAbortListener = cancellation.signal.removeEventListener.bind(
      cancellation.signal,
    );
    const startupAbort = {
      get aborted() {
        const value = cancellation.signal.aborted;
        abortedReads += 1;
        if (abortedReads === 1) cancellation.abort();
        return value;
      },
      addEventListener: addAbortListener,
      removeEventListener: removeAbortListener,
    } as unknown as AbortSignal;

    const grade = await gradeHiddenTests(
      openedWorkspace,
      [
        {
          id: "startup-cancellation",
          runtime: "node",
          source: `await new Promise((resolve) => setTimeout(resolve, 100));
require("node:fs").writeFileSync(
  path.join(workspaceRoot, "startup-grader-ran.txt"),
  "ran",
);`,
        },
      ],
      { signal: startupAbort },
    );

    expect(grade.failedIds).toEqual(["startup-cancellation"]);
    await expect(
      openedWorkspace.exists("startup-grader-ran.txt"),
    ).resolves.toBe(false);
  });

  it("removes the disposable grader directory after grading", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "grader-parent-"));
    temporaryRoots.push(temporaryRoot);
    const openedWorkspace = await workspace();
    const grade = await gradeHiddenTests(
      openedWorkspace,
      [
        {
          id: "cleanup",
          runtime: "node",
          source: `require("node:fs").writeFileSync(
  path.join(workspaceRoot, "grader-root.txt"),
  __dirname,
);`,
        },
      ],
      { temporaryRoot },
    );
    const graderRoot = await openedWorkspace.readFile("grader-root.txt");
    const realTemporaryRoot = await realpath(temporaryRoot);

    expect(grade.passed).toBe(1);
    expect(graderRoot.startsWith(realTemporaryRoot)).toBe(true);
    expect(existsSync(graderRoot)).toBe(false);
  });

  it("executes Python repaired modules in a disposable child process", async () => {
    const openedWorkspace = await workspace();
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-isolated-process",
        runtime: "python",
        source: `import os
from pathlib import Path
Path("python-child-pid.txt").write_text(str(os.getpid()), encoding="utf-8")`,
      },
    ]);

    expect(grade.passedIds).toEqual(["python-isolated-process"]);
    expect(
      Number(await openedWorkspace.readFile("python-child-pid.txt")),
    ).not.toBe(process.pid);
  });

  it("does not let repaired Python modules forge a passing grader result", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model_authored.py",
      `import json
json.dumps = lambda _value: '{"passed": true}'
`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-result-forgery",
        runtime: "python",
        source: `import model_authored
assert False, "the hidden assertion must fail"`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      passedIds: [],
      failedIds: ["python-result-forgery"],
    });
  });

  it("does not trust a Python result written before model-authored code exits", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model_authored.py",
      `import json
import os
import sys
from pathlib import Path

Path(sys.argv[0]).with_name("result.json").write_text(
    json.dumps({"passed": True}), encoding="utf-8"
)
os._exit(0)
`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-direct-result-forgery",
        runtime: "python",
        source: "import model_authored",
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      passedIds: [],
      failedIds: ["python-direct-result-forgery"],
    });
  });

  it("does not expose Python grader state through the main module", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model_authored.py",
      `import __main__
__main__.passed = True
`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-main-state-forgery",
        runtime: "python",
        source: `import model_authored
assert False, "the hidden assertion must fail"`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      failedIds: ["python-main-state-forgery"],
    });
  });

  it("does not let Python frame inspection authenticate a forged result", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model_authored.py",
      `import inspect
import json
import os

frame = inspect.currentframe()
while frame is not None:
    authentication = frame.f_locals.get("authentication")
    if isinstance(authentication, bytes) and authentication:
        os.write(3, json.dumps({
            "authentication": authentication.decode("ascii"),
            "passed": True,
        }, separators=(",", ":")).encode("utf-8"))
        os._exit(0)
    frame = frame.f_back
`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-frame-result-forgery",
        runtime: "python",
        source: `import model_authored
assert False, "the hidden assertion must fail"`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      failedIds: ["python-frame-result-forgery"],
    });
    await expect(openedWorkspace.exists("result.json")).resolves.toBe(false);
  });

  it("isolates the Python supervisor from workspace import shadowing", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "subprocess.py",
      `import os

authentication = b""
while True:
    chunk = os.read(4, 1024)
    if not chunk:
        break
    authentication += chunk
os.write(
    3,
    b'{"authentication":"' + authentication + b'","passed":true}',
)
os._exit(0)
`,
    );
    await openedWorkspace.writeFile("submission.py", "value = 42\n");

    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "workspace-import-shadow-forgery",
        runtime: "python",
        source: `raise AssertionError("the hidden assertion must fail")`,
      },
      {
        id: "worker-imports-workspace-submission",
        runtime: "python",
        source: `from submission import value
assert value == 42`,
      },
    ]);

    expect(grade).toEqual({
      total: 2,
      passed: 1,
      ratio: 0.5,
      passedIds: ["worker-imports-workspace-submission"],
      failedIds: ["workspace-import-shadow-forgery"],
    });
  });

  it("does not let Python exit hooks replace a failing grader result", async () => {
    const openedWorkspace = await workspace();
    await openedWorkspace.writeFile(
      "model_authored.py",
      `import atexit
import json
import sys
from pathlib import Path

def forge_result():
    Path(sys.argv[0]).with_name("result.json").write_text(
        json.dumps({"passed": True}), encoding="utf-8"
    )

atexit.register(forge_result)
`,
    );
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "python-exit-forgery",
        runtime: "python",
        source: `import model_authored
assert False, "the hidden assertion must fail"`,
      },
    ]);

    expect(grade).toMatchObject({
      passed: 0,
      failedIds: ["python-exit-forgery"],
    });
  });

  it("does not expose runner credentials or arbitrary environment variables", async () => {
    const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = "provider-secret";
    try {
      const grade = await gradeHiddenTests(await workspace(), [
        {
          id: "sanitized-environment",
          runtime: "node",
          source: `assert.equal(process.env.BLOB_READ_WRITE_TOKEN, undefined);
assert.equal(process.env.LANG, "C");
assert.equal(
  process.env.PATH,
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
);`,
        },
      ]);

      expect(grade.passedIds).toEqual(["sanitized-environment"]);
    } finally {
      if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    }
  });

  it("prevents model-authored Node code from spawning more processes", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      {
        id: "no-descendants",
        runtime: "node",
        source: `assert.throws(() => {
  require("node:child_process").spawnSync(process.execPath, ["-e", "0"]);
});`,
      },
    ]);

    expect(grade.passedIds).toEqual(["no-descendants"]);
  });

  it("terminates descendant processes when a grader times out", async () => {
    const openedWorkspace = await workspace();
    const grade = await gradeHiddenTests(
      openedWorkspace,
      [
        {
          id: "grandchild",
          runtime: "python",
          source: `import subprocess
import time
marker = str(Path("grandchild-survived.txt").resolve())
Path("grandchild-started.txt").write_text("started", encoding="utf-8")
subprocess.Popen([
    sys.executable,
    "-c",
    f'import time; from pathlib import Path; time.sleep(0.3); Path({marker!r}).write_text("alive")',
])
time.sleep(1)`,
        },
      ],
      { timeoutMs: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(grade.failedIds).toEqual(["grandchild"]);
    await expect(
      openedWorkspace.exists("grandchild-started.txt"),
    ).resolves.toBe(true);
    await expect(
      openedWorkspace.exists("grandchild-survived.txt"),
    ).resolves.toBe(false);
  });

  it("terminates Python descendants after a successful grader exits", async () => {
    const openedWorkspace = await workspace();
    const grade = await gradeHiddenTests(openedWorkspace, [
      {
        id: "successful-parent-with-grandchild",
        runtime: "python",
        source: `import subprocess
marker = str(Path("successful-grandchild-survived.txt").resolve())
subprocess.Popen(
    [
        sys.executable,
        "-c",
        f'import time; from pathlib import Path; time.sleep(0.2); Path({marker!r}).write_text("alive")',
    ],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)`,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(grade.passedIds).toEqual(["successful-parent-with-grandchild"]);
    await expect(
      openedWorkspace.exists("successful-grandchild-survived.txt"),
    ).resolves.toBe(false);
  });

  it("falls back to direct termination if process-group termination fails", async () => {
    const exactKill = Reflect.get(process, "kill");
    const invokeExactKill = exactKill.bind(process);
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((pid, signal) => {
        if (pid < 0) throw new Error("process groups unavailable");
        return invokeExactKill(pid, signal);
      });
    try {
      const grade = await gradeHiddenTests(
        await workspace(),
        [
          {
            id: "fallback-kill",
            runtime: "node",
            source:
              "await new Promise((resolve) => setTimeout(resolve, 1_000));",
          },
        ],
        { timeoutMs: 20 },
      );
      expect(grade.failedIds).toEqual(["fallback-kill"]);
    } finally {
      killSpy.mockRestore();
    }
    expect(Reflect.get(process, "kill")).toBe(exactKill);
  });

  it("fails cleanly when the grader process cannot start or exits non-zero", async () => {
    const previousPython = process.env.LLMBENCH_PYTHON;
    process.env.LLMBENCH_PYTHON = "/missing/llm-bench-python";
    try {
      await expect(
        gradeHiddenTests(await workspace(), [
          {
            id: "missing-runtime",
            runtime: "python",
            source: "assert True",
          },
        ]),
      ).rejects.toThrow("runtime could not start");
    } finally {
      if (previousPython === undefined) delete process.env.LLMBENCH_PYTHON;
      else process.env.LLMBENCH_PYTHON = previousPython;
    }

    const nonZero = await gradeHiddenTests(await workspace(), [
      {
        id: "non-zero",
        runtime: "node",
        source: "process.exit(7);",
      },
    ]);
    expect(nonZero.failedIds).toEqual(["non-zero"]);
  });

  it("does not start another grader after cancellation is already active", async () => {
    const cancellation = new AbortController();
    cancellation.abort();

    await expect(
      gradeHiddenTests(
        await workspace(),
        [
          {
            id: "already-cancelled",
            runtime: "node",
            source: 'throw new Error("must not run");',
          },
        ],
        { signal: cancellation.signal },
      ),
    ).resolves.toMatchObject({
      passed: 0,
      failedIds: ["already-cancelled"],
    });
  });

  it("reports a zero ratio when there are no hidden tests", async () => {
    const grade = await gradeHiddenTests(await workspace(), []);

    expect(grade).toEqual({
      total: 0,
      passed: 0,
      ratio: 0,
      passedIds: [],
      failedIds: [],
    });
  });
});
