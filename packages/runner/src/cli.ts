import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

import { VercelBlobUploader } from "./blob-uploader";
import { RunnerCli } from "./cli-app";
import { runDaemonLoop } from "./daemon";
import { runnerHome } from "./env";
import {
  pollRunnerPairing,
  RunnerHttpTransport,
  startRunnerPairing,
} from "./http-transport";
import { RunnerStateStore } from "./state";
import { probeRunnerSystem } from "./system";
import { TracerExecutor } from "./tracer-executor";
import { RunnerWorker } from "./worker";

const state = new RunnerStateStore(runnerHome());

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "daemon") {
    await runDaemon();
    return;
  }
  const cli = new RunnerCli({
    state,
    output: (line) => console.log(line),
    keyPair: generateRunnerKeyPair,
    probe: probeRunnerSystem,
    pairing: {
      start: (input) => startRunnerPairing(input),
      poll: (serverUrl, deviceCode) => pollRunnerPairing(serverUrl, deviceCode),
    },
    transport: (credentials) => new RunnerHttpTransport(credentials),
    lifecycle: {
      start: () => {
        const executable = process.argv[1];
        if (!executable)
          throw new Error("Runner executable path is unavailable.");
        const child = spawn(process.execPath, [executable, "daemon"], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        if (!child.pid) throw new Error("Runner process did not start.");
        return Promise.resolve(child.pid);
      },
      stop: (pid) => {
        process.kill(pid, "SIGTERM");
        return Promise.resolve();
      },
      isRunning: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      },
    },
    sleep,
  });
  await cli.run(arguments_);
}

async function runDaemon(): Promise<void> {
  const credentials = await state.credentials();
  if (!credentials) throw new Error("Runner is not logged in.");
  const transport = new RunnerHttpTransport(credentials);
  const worker = new RunnerWorker({
    state,
    transport,
    executor: new TracerExecutor(state.root),
    artifactUploader: new VercelBlobUploader(
      credentials,
      state.path("artifacts"),
    ),
  });
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  await runDaemonLoop({
    heartbeat: () => transport.heartbeat(),
    runOnce: () => worker.runOnce(),
    sleep,
    stopping: () => stopping,
    onError: (error) =>
      console.error(
        error instanceof Error ? error.message : "Runner request failed.",
      ),
    intervalMs: 2000,
  });
}

function generateRunnerKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    privateKey: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runner failed.");
  process.exitCode = 1;
});
