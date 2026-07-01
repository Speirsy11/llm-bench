import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types";
import { createCommandTool } from "./command";
import { ToolInputError } from "./repository";

const context: ToolContext = {
  root: process.cwd(),
  signal: new AbortController().signal,
};

describe("createCommandTool", () => {
  it("runs a fixed command with injected executor and captures output", async () => {
    const executor = vi.fn(() =>
      Promise.resolve({
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
      }),
    );
    const tool = createCommandTool(
      {
        name: "run_tests",
        description: "run",
        command: "vitest",
        args: ["run"],
      },
      executor,
    );
    const result = await tool.execute("{}", context);
    expect(result).toBe("exit 0\nok\n");
    expect(executor).toHaveBeenCalledWith("vitest", ["run"], expect.anything());
  });

  it("appends model arguments only when allowed", async () => {
    const executor = vi.fn(() =>
      Promise.resolve({
        stdout: "",
        stderr: "err",
        exitCode: 2,
      }),
    );
    const tool = createCommandTool(
      {
        name: "grep",
        description: "search",
        command: "rg",
        allowExtraArgs: true,
      },
      executor,
    );
    const result = await tool.execute(
      JSON.stringify({ args: ["needle"] }),
      context,
    );
    expect(executor).toHaveBeenCalledWith("rg", ["needle"], expect.anything());
    expect(result).toBe("exit 2\nerr");
  });

  it("rejects arguments when the task disallows them", async () => {
    const tool = createCommandTool(
      { name: "build", description: "build", command: "tsc" },
      () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    );
    await expect(
      tool.execute(JSON.stringify({ args: ["--watch"] }), context),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("ignores an omitted args field and empty argument payloads", async () => {
    const executor = vi.fn(() =>
      Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    );
    const tool = createCommandTool(
      {
        name: "build",
        description: "build",
        command: "tsc",
        allowExtraArgs: true,
      },
      executor,
    );
    await tool.execute("", context);
    await tool.execute(JSON.stringify({}), context);
    await tool.execute(JSON.stringify({ unrelated: 1 }), context);
    expect(executor).toHaveBeenLastCalledWith("tsc", [], expect.anything());
  });

  it("validates the args payload shape", async () => {
    const tool = createCommandTool(
      { name: "grep", description: "s", command: "rg", allowExtraArgs: true },
      () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
    );
    await expect(tool.execute("{not json", context)).rejects.toThrow(
      /valid JSON/,
    );
    await expect(
      tool.execute(JSON.stringify({ args: [1] }), context),
    ).rejects.toThrow(/array of strings/);
  });

  it("truncates output to the configured maximum", async () => {
    const tool = createCommandTool(
      {
        name: "noisy",
        description: "n",
        command: "cat",
        maxOutputChars: 4,
      },
      () => Promise.resolve({ stdout: "abcdef…", stderr: "", exitCode: 0 }),
    );
    expect(await tool.execute("{}", context)).toBe("exit 0\nabcd");
  });

  it("uses the default executor to run a real process", async () => {
    const tool = createCommandTool({
      name: "node_version",
      description: "print",
      command: process.execPath,
      args: ["-e", "process.stdout.write('hi')"],
    });
    const result = await tool.execute("{}", context);
    expect(result).toBe("exit 0\nhi");
  });

  it("reports a non-zero exit from the default executor", async () => {
    const tool = createCommandTool({
      name: "node_fail",
      description: "fail",
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
    });
    expect(await tool.execute("{}", context)).toBe("exit 3\n");
  });

  it("reports a spawn failure from the default executor", async () => {
    const tool = createCommandTool({
      name: "missing",
      description: "missing",
      command: "this-binary-does-not-exist-xyz",
    });
    const result = await tool.execute("{}", context);
    expect(result.startsWith("exit 1")).toBe(true);
  });
});
