import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { SEALED_CREDENTIAL_ALGORITHM } from "@llm-bench/contracts";

import { createCredentialSubmission, CredentialForm } from "./credential-form";

const RUNNER_ID = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";
const PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const SECRET_CANARY = "sk-or-v1-canary-never-submit-7f3a";
const CIPHERTEXT =
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB";

describe("CredentialForm", () => {
  it("submits only masked metadata and canonical ciphertext", async () => {
    const submitted = await createCredentialSubmission(
      {
        label: "OpenRouter",
        provider: "openrouter",
        runnerId: RUNNER_ID,
        publicKey: PUBLIC_KEY,
        secret: SECRET_CANARY,
      },
      () =>
        Promise.resolve({
          algorithm: SEALED_CREDENTIAL_ALGORITHM,
          runnerId: RUNNER_ID,
          keyFingerprint: "ZmFrZS1maW5nZXJwcmludA==",
          ciphertext: CIPHERTEXT,
        }),
    );

    expect(Object.fromEntries(submitted)).toEqual({
      label: "OpenRouter",
      provider: "openrouter",
      runnerId: RUNNER_ID,
      maskedSecret: "••••7f3a",
      algorithm: SEALED_CREDENTIAL_ALGORITHM,
      keyFingerprint: "ZmFrZS1maW5nZXJwcmludA==",
      ciphertext: CIPHERTEXT,
    });
    expect(serializedValues(submitted)).not.toContain("canary");
    expect(serializedValues(submitted)).not.toContain(SECRET_CANARY);
    expect(submitted.has("secret")).toBe(false);
  });

  it("clears the plaintext after the sealed submission succeeds", async () => {
    const submissions: FormData[] = [];
    const rendered = await renderCredentialForm({
      action: (formData) => {
        submissions.push(formData);
      },
    });
    await enterSecret(rendered, SECRET_CANARY);
    await act(async () => {
      submit(rendered.renderer);
      await Promise.resolve();
    });

    expect(submissions).toHaveLength(1);
    const submission = submissions[0];
    if (!submission) throw new Error("Credential was not submitted.");
    expect(serializedValues(submission)).not.toContain("canary");
    expect(readSecret(rendered)).toBe("");
    rendered.renderer.unmount();
  });

  it("does not retain plaintext in rendered React props", async () => {
    const rendered = await renderCredentialForm();

    await enterSecret(rendered, SECRET_CANARY);

    const inputProps = rendered.renderer.root.findByProps({
      id: "credential-secret",
    }).props as Record<string, unknown>;
    const { ref: _domRef, ...reactProps } = inputProps;
    expect(JSON.stringify(reactProps)).not.toContain(SECRET_CANARY);
    expect(readSecret(rendered)).toBe(SECRET_CANARY);
    rendered.renderer.unmount();
  });

  it.each(["seal", "submission"] as const)(
    "clears the plaintext when %s fails",
    async (failure) => {
      const rendered = await renderCredentialForm({
        action:
          failure === "submission"
            ? () => Promise.reject(new Error("submission failed"))
            : undefined,
        seal:
          failure === "seal"
            ? () => Promise.reject(new Error("sealing failed"))
            : undefined,
      });
      await enterSecret(rendered, SECRET_CANARY);

      await act(async () => {
        submit(rendered.renderer);
        await Promise.resolve();
      });

      expect(readSecret(rendered)).toBe("");
      expect(
        rendered.renderer.root.findByProps({ role: "status" }).children,
      ).toContain(`${failure === "seal" ? "sealing" : "submission"} failed`);
      rendered.renderer.unmount();
    },
  );

  it("clears the plaintext as soon as sealing starts", async () => {
    let finishSealing: ((sealed: SealedCredentialFixture) => void) | undefined;
    const rendered = await renderCredentialForm({
      seal: () =>
        new Promise((resolve) => {
          finishSealing = resolve;
        }),
    });
    await enterSecret(rendered, SECRET_CANARY);

    act(() => submit(rendered.renderer));

    expect(readSecret(rendered)).toBe("");
    await act(async () => {
      finishSealing?.(SEALED_CREDENTIAL_FIXTURE);
      await Promise.resolve();
    });
    rendered.renderer.unmount();
  });

  it("rejects short or non-OpenRouter secrets before sealing or submission", async () => {
    let sealed = false;
    for (const secret of ["abc", "sk-or-v1-short"]) {
      await expect(
        createCredentialSubmission(
          {
            label: "OpenRouter",
            provider: "openrouter",
            runnerId: RUNNER_ID,
            publicKey: PUBLIC_KEY,
            secret,
          },
          () => {
            sealed = true;
            throw new Error("must not seal");
          },
        ),
      ).rejects.toThrow("valid OpenRouter API key");
    }
    expect(sealed).toBe(false);
  });
});

const SEALED_CREDENTIAL_FIXTURE = {
  algorithm: SEALED_CREDENTIAL_ALGORITHM,
  runnerId: RUNNER_ID,
  keyFingerprint: "ZmFrZS1maW5nZXJwcmludA==",
  ciphertext: CIPHERTEXT,
} as const;

type SealedCredentialFixture = typeof SEALED_CREDENTIAL_FIXTURE;
interface SecretInputNode {
  value: string;
}
interface RenderedCredentialForm {
  readonly renderer: ReactTestRenderer;
  readonly secretInput: SecretInputNode;
}
interface SecretInputProps {
  readonly onChange?: (event: { target: { value: string } }) => void;
  readonly value?: unknown;
}

async function renderCredentialForm({
  action = () => undefined,
  seal = () => Promise.resolve(SEALED_CREDENTIAL_FIXTURE),
}: {
  readonly action?: (formData: FormData) => void | Promise<void>;
  readonly seal?: () => Promise<SealedCredentialFixture>;
} = {}): Promise<RenderedCredentialForm> {
  let renderer: ReactTestRenderer | undefined;
  let secretInput: SecretInputNode | undefined;
  await act(() => {
    renderer = create(
      <CredentialForm
        action={action}
        runner={{ id: RUNNER_ID, publicKey: PUBLIC_KEY }}
        seal={seal}
      />,
      {
        createNodeMock(element) {
          const props = element.props as Record<string, unknown>;
          if (element.type === "input" && props.id === "credential-secret") {
            secretInput = {
              value: typeof props.value === "string" ? props.value : "",
            };
            return secretInput;
          }
          return {};
        },
      },
    );
  });
  if (!renderer) throw new Error("Renderer was not created.");
  secretInput ??= renderer.root.findByProps({
    id: "credential-secret",
  }).instance as SecretInputNode | undefined;
  if (!secretInput) throw new Error("Secret input was not created.");
  return { renderer, secretInput };
}

async function enterSecret(
  rendered: RenderedCredentialForm,
  secret: string,
): Promise<void> {
  rendered.secretInput.value = secret;
  const input = rendered.renderer.root.findByProps({
    id: "credential-secret",
  });
  const onChange = (input.props as SecretInputProps).onChange;
  if (onChange) {
    await act(() => onChange({ target: { value: secret } }));
  }
}

function readSecret(rendered: RenderedCredentialForm): string {
  const props = rendered.renderer.root.findByProps({
    id: "credential-secret",
  }).props as Record<string, unknown>;
  return typeof props.value === "string"
    ? props.value
    : rendered.secretInput.value;
}

function submit(renderer: ReactTestRenderer): void {
  const form = renderer.root.findByType("form");
  const formProps = form.props as {
    onSubmit(event: { preventDefault(): void }): void;
  };
  formProps.onSubmit({ preventDefault: () => undefined });
}

function serializedValues(formData: FormData): string {
  return [...formData.values()]
    .map((value) => (typeof value === "string" ? value : "[file]"))
    .join("\n");
}
