"use client";

import { useRef, useState } from "react";

export function RunnerPairingForm() {
  const [userCode, setUserCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submittingRef.current) return;
        setMessage(null);
        submittingRef.current = true;
        setSubmitting(true);
        void approveRunnerPairing(userCode)
          .then(setMessage)
          .catch((error: unknown) =>
            setMessage(
              error instanceof Error ? error.message : "Pairing failed.",
            ),
          )
          .finally(() => {
            submittingRef.current = false;
            setSubmitting(false);
          });
      }}
    >
      <label htmlFor="runner-code">Runner pairing code</label>
      <input
        id="runner-code"
        name="runner-code"
        autoComplete="one-time-code"
        required
        disabled={submitting}
        value={userCode}
        onChange={(event) => setUserCode(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        Pair runner
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

export async function approveRunnerPairing(
  userCode: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher("/api/v1/runner/pairings/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userCode: userCode.trim() }),
  });
  const body = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Pairing failed.");
  return "Runner paired. You can close this page.";
}
