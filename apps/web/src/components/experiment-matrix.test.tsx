import type {
  ReactTestRenderer,
  ReactTestRendererJSON,
} from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import type { ExperimentPreview } from "@llm-bench/control-plane";

import { ExperimentMatrix } from "./experiment-matrix";

describe("ExperimentMatrix", () => {
  it("updates the visible target preview when the user selects a harness", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <ExperimentMatrix
          credentialProfileId="credential-1"
          initialHarnessId="llmbench"
          previews={{
            llmbench: previewFixture({
              harnessId: "llmbench",
              modelRouteIds: ["openrouter-gpt-4o", "openrouter-llama"],
              toolsetId: "builtin",
            }),
            codex: previewFixture({
              harnessId: "codex",
              modelRouteIds: ["codex-gpt-5.4"],
              toolsetId: "native",
            }),
            claude: previewFixture({
              harnessId: "claude",
              modelRouteIds: ["claude-sonnet-4-6"],
              toolsetId: "native",
            }),
          }}
          runnerId="runner-1"
        />,
      );
    });
    if (!renderer) throw new Error("Renderer was not created.");

    expect(projectedJobCount(renderer)).toBe("2");
    expect(renderedText(renderer)).toContain("projected jobs");
    expect(renderedText(renderer)).toContain(
      "openrouter-gpt-4o · llmbench · builtin",
    );

    const codexRadio = renderer.root.findByProps({
      name: "harness",
      value: "codex",
    });
    const codexRadioProps = codexRadio.props as { onChange(): void };
    await act(() => codexRadioProps.onChange());

    expect(projectedJobCount(renderer)).toBe("1");
    expect(renderedText(renderer)).toContain("projected job");
    expect(renderedText(renderer)).toContain("codex-gpt-5.4 · codex · native");
    expect(renderedText(renderer)).not.toContain(
      "openrouter-gpt-4o · llmbench · builtin",
    );

    const claudeRadio = renderer.root.findByProps({
      name: "harness",
      value: "claude",
    });
    const claudeRadioProps = claudeRadio.props as { onChange(): void };
    await act(() => claudeRadioProps.onChange());

    expect(projectedJobCount(renderer)).toBe("1");
    expect(renderedText(renderer)).toContain(
      "claude-sonnet-4-6 · claude · native",
    );
    expect(renderedText(renderer)).not.toContain(
      "codex-gpt-5.4 · codex · native",
    );

    renderer.unmount();
  });

  it("keeps harness choices available when the selected preview is blocked", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <ExperimentMatrix
          credentialProfileId="credential-1"
          initialHarnessId="llmbench"
          previews={{
            llmbench: {
              ...previewFixture({
                harnessId: "llmbench",
                modelRouteIds: ["openrouter-gpt-4o"],
                toolsetId: "builtin",
              }),
              canLaunch: false,
              blockers: ["LLMBench is unavailable."],
            },
            codex: previewFixture({
              harnessId: "codex",
              modelRouteIds: ["codex-gpt-5.4"],
              toolsetId: "native",
            }),
          }}
          runnerId="runner-1"
        />,
      );
    });
    if (!renderer) throw new Error("Renderer was not created.");

    expect(renderer.root.findByType("button").props.disabled).toBe(true);
    const codexRadio = renderer.root.findByProps({
      name: "harness",
      value: "codex",
    });
    await act(() => (codexRadio.props as { onChange(): void }).onChange());

    expect(renderer.root.findByType("button").props.disabled).toBe(false);
    expect(renderedText(renderer)).toContain("codex-gpt-5.4 · codex · native");
    renderer.unmount();
  });

  it("omits harness choices the paired runner cannot execute", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <ExperimentMatrix
          initialHarnessId="codex"
          previews={{
            codex: previewFixture({
              harnessId: "codex",
              modelRouteIds: ["codex-gpt-5.4"],
              toolsetId: "native",
            }),
          }}
          runnerId="runner-1"
        />,
      );
    });
    if (!renderer) throw new Error("Renderer was not created.");

    expect(
      renderer.root.findAllByProps({ name: "harness", value: "llmbench" }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ name: "harness", value: "claude" }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ name: "harness", value: "codex" }),
    ).toHaveLength(1);
    renderer.unmount();
  });
});

function previewFixture({
  harnessId,
  modelRouteIds,
  toolsetId,
}: {
  readonly harnessId: "llmbench" | "codex" | "claude";
  readonly modelRouteIds: readonly string[];
  readonly toolsetId: "builtin" | "native";
}): ExperimentPreview {
  const modelRoutes = modelRouteIds.map((id) => ({
    id,
    provider: harnessId === "llmbench" ? "openrouter" : harnessId,
    model: id,
  }));
  const capabilities = ["response_generation", "workspaces", "files"] as const;
  return {
    input: {
      name: "Repository repair",
      runnerId: "runner-1",
      ...(harnessId === "llmbench"
        ? { credentialProfileId: "credential-1" }
        : {}),
      modelRoutes,
      harnesses: [
        {
          id: harnessId,
          version: "1.0.0",
          capabilities: [...capabilities],
          modelRoutes,
        },
      ],
      toolsets: [
        {
          id: toolsetId,
          version: "1.0.0",
          tools: toolsetId === "builtin" ? ["read_file"] : [],
          mcpProfiles: [],
        },
      ],
    },
    projectedJobCount: modelRouteIds.length,
    spend: { kind: "unknown" },
    canLaunch: true,
    blockers: [],
    order: modelRouteIds.map((modelRouteId, position) => ({
      position,
      modelRouteId,
      harnessId,
      toolsetId,
      requiredCapabilities: capabilities,
    })),
  };
}

function renderedText(renderer: ReactTestRenderer): string {
  return textFrom(renderer.toJSON());
}

function projectedJobCount(renderer: ReactTestRenderer): string {
  return renderer.root.findByProps({ className: "text-3xl font-semibold" })
    .children[0] as string;
}

function textFrom(
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textFrom).join("");
  return node.children?.map(textFrom).join("") ?? "";
}
