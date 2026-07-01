import { RunnerPairingForm } from "@/components/runner-pairing-form";

export default function RunnerPairingPage() {
  return (
    <main>
      <h1>Pair a runner</h1>
      <p>Enter the one-time code shown by the runner CLI.</p>
      <RunnerPairingForm />
    </main>
  );
}
