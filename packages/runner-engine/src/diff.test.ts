import { describe, expect, it } from "vitest";

import { captureDiff, renderDiffText } from "./diff";

describe("captureDiff", () => {
  it("omits files whose content is unchanged", () => {
    const before = new Map([["a.txt", "same"]]);
    const after = new Map([["a.txt", "same"]]);

    expect(captureDiff(before, after).entries).toEqual([]);
  });

  it("records an added file with no prior content", () => {
    const diff = captureDiff(new Map(), new Map([["new.txt", "hello"]]));

    expect(diff.entries).toEqual([
      { path: "new.txt", status: "added", before: null, after: "hello" },
    ]);
  });

  it("records a removed file with no later content", () => {
    const diff = captureDiff(new Map([["gone.txt", "bye"]]), new Map());

    expect(diff.entries).toEqual([
      { path: "gone.txt", status: "removed", before: "bye", after: null },
    ]);
  });

  it("records a modified file with both versions", () => {
    const diff = captureDiff(
      new Map([["f.txt", "old"]]),
      new Map([["f.txt", "new"]]),
    );

    expect(diff.entries).toEqual([
      { path: "f.txt", status: "modified", before: "old", after: "new" },
    ]);
  });

  it("lists changed paths sorted", () => {
    const diff = captureDiff(
      new Map([["z.txt", "1"]]),
      new Map([
        ["z.txt", "2"],
        ["a.txt", "added"],
      ]),
    );

    expect(diff.changedPaths).toEqual(["a.txt", "z.txt"]);
  });
});

describe("renderDiffText", () => {
  it("renders a deterministic unified-style summary per changed file", () => {
    const diff = captureDiff(
      new Map([["src/sum.mjs", "old\n"]]),
      new Map([["src/sum.mjs", "new\n"]]),
    );

    expect(renderDiffText(diff)).toBe(
      ["--- a/src/sum.mjs", "+++ b/src/sum.mjs", "-old", "+new", ""].join("\n"),
    );
  });

  it("marks an added file's missing side with /dev/null and a no-newline note", () => {
    const diff = captureDiff(new Map(), new Map([["new.txt", "alpha"]]));

    expect(renderDiffText(diff)).toBe(
      [
        "--- /dev/null",
        "+++ b/new.txt",
        "+alpha",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
    );
  });

  it("marks a removed file's missing side with /dev/null", () => {
    const diff = captureDiff(new Map([["gone.txt", "bye\n"]]), new Map());

    expect(renderDiffText(diff)).toBe(
      ["--- a/gone.txt", "+++ /dev/null", "-bye", ""].join("\n"),
    );
  });

  it("renders distinct text for an added versus a removed empty file", () => {
    const added = renderDiffText(captureDiff(new Map(), new Map([["e", ""]])));
    const removed = renderDiffText(
      captureDiff(new Map([["e", ""]]), new Map()),
    );

    expect(added).toBe(["--- /dev/null", "+++ b/e", ""].join("\n"));
    expect(removed).toBe(["--- a/e", "+++ /dev/null", ""].join("\n"));
    expect(added).not.toBe(removed);
  });

  it("renders distinct text for `foo` versus `foo\\n`", () => {
    const noNewline = renderDiffText(
      captureDiff(new Map([["f", "x\n"]]), new Map([["f", "foo"]])),
    );
    const withNewline = renderDiffText(
      captureDiff(new Map([["f", "x\n"]]), new Map([["f", "foo\n"]])),
    );

    expect(noNewline).toContain("+foo\n\\ No newline at end of file");
    expect(withNewline).toContain("+foo\n");
    expect(withNewline).not.toContain("No newline");
    expect(noNewline).not.toBe(withNewline);
  });

  it("renders an empty string when nothing changed", () => {
    expect(renderDiffText(captureDiff(new Map(), new Map()))).toBe("");
  });
});
