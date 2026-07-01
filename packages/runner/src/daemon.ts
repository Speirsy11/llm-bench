export async function runDaemonLoop(options: {
  heartbeat(): Promise<void>;
  runOnce(): Promise<unknown>;
  sleep(milliseconds: number): Promise<void>;
  stopping(): boolean;
  onError(error: unknown): void;
  intervalMs: number;
}): Promise<void> {
  while (!options.stopping()) {
    try {
      await options.heartbeat();
      await options.runOnce();
    } catch (error) {
      options.onError(error);
    }
    if (!options.stopping()) await options.sleep(options.intervalMs);
  }
}
