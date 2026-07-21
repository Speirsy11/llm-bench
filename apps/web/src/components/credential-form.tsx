"use client";

import { useRef, useState } from "react";

import type { SealedCredential } from "@llm-bench/contracts";
import type { SealCredentialInput } from "@llm-bench/crypto/browser";
import { sealCredential } from "@llm-bench/crypto/browser";

import { maskOpenRouterSecret } from "../app/dashboard/credential-input";

type FormAction = (formData: FormData) => void | Promise<void>;
type SealCredential = (input: SealCredentialInput) => Promise<SealedCredential>;

export function CredentialForm({
  action,
  runner,
  seal = sealCredential,
}: {
  readonly action: FormAction;
  readonly runner: { readonly id: string; readonly publicKey: string };
  readonly seal?: SealCredential;
}) {
  const [label, setLabel] = useState("OpenRouter");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  return (
    <form
      className="border-border mt-5 grid gap-3 border-t pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittingRef.current) return;
        const secretInput = secretInputRef.current;
        if (!secretInput) return;
        submittingRef.current = true;
        setSubmitting(true);
        setMessage(null);
        const secret = secretInput.value;
        secretInput.value = "";
        void createCredentialSubmission(
          {
            label,
            provider: "openrouter",
            runnerId: runner.id,
            publicKey: runner.publicKey,
            secret,
          },
          seal,
        )
          .then(action)
          .then(() => {
            setMessage("Credential saved.");
          })
          .catch((error: unknown) =>
            setMessage(
              error instanceof Error
                ? error.message
                : "Credential could not be sealed.",
            ),
          )
          .finally(() => {
            secretInput.value = "";
            submittingRef.current = false;
            setSubmitting(false);
          });
      }}
    >
      <label
        className="grid gap-2 text-sm font-medium"
        htmlFor="credential-label"
      >
        Label
        <input
          className="border-input bg-background rounded-md border px-3 py-2"
          disabled={submitting}
          id="credential-label"
          onChange={(event) => setLabel(event.target.value)}
          required
          value={label}
        />
      </label>
      <label
        className="grid gap-2 text-sm font-medium"
        htmlFor="credential-secret"
      >
        OpenRouter API key
        <input
          autoComplete="off"
          className="border-input bg-background rounded-md border px-3 py-2"
          disabled={submitting}
          id="credential-secret"
          ref={secretInputRef}
          required
          spellCheck={false}
          type="password"
        />
      </label>
      <p className="text-muted-foreground text-xs">
        Your key is encrypted in this browser for {runner.id} before it is sent.
      </p>
      <button
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Sealing…" : "Save credential"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

export async function createCredentialSubmission(
  input: {
    readonly label: string;
    readonly provider: string;
    readonly runnerId: string;
    readonly publicKey: string;
    readonly secret: string;
  },
  seal: SealCredential = sealCredential,
): Promise<FormData> {
  const maskedSecret = maskOpenRouterSecret(input.secret);
  const sealed = await seal({
    runnerId: input.runnerId,
    recipientPublicKey: input.publicKey,
    secret: input.secret,
  });
  const formData = new FormData();
  formData.set("label", input.label);
  formData.set("provider", input.provider);
  formData.set("runnerId", input.runnerId);
  formData.set("maskedSecret", maskedSecret);
  formData.set("algorithm", sealed.algorithm);
  formData.set("keyFingerprint", sealed.keyFingerprint);
  formData.set("ciphertext", sealed.ciphertext);
  return formData;
}
