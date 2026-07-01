import type {
  RunnerEnvironment,
  RunnerPairingPollResponse,
  RunnerPairingStartResponse,
} from "@llm-bench/contracts";

import type { RunnerCredentials, RunnerStateStore } from "./state";

export interface CapabilityProbe {
  capabilities: ("workspaces" | "files")[];
  environment: RunnerEnvironment;
  issues: string[];
}

interface CliOptions {
  state: RunnerStateStore;
  output(line: string): void;
  keyPair(): { publicKey: string; privateKey: string };
  probe(): CapabilityProbe;
  pairing: {
    start(input: {
      serverUrl: string;
      name: string;
      publicKey: string;
      capabilities: ("workspaces" | "files")[];
      environment: RunnerEnvironment;
    }): Promise<RunnerPairingStartResponse>;
    poll(
      serverUrl: string,
      deviceCode: string,
    ): Promise<RunnerPairingPollResponse>;
  };
  transport(credentials: RunnerCredentials): {
    logout(runnerId: string): Promise<void>;
    heartbeat(): Promise<void>;
  };
  lifecycle: {
    start(credentials: RunnerCredentials): Promise<number>;
    stop(pid: number): Promise<void>;
    isRunning(pid: number): boolean;
  };
  sleep(milliseconds: number): Promise<void>;
}

export class RunnerCli {
  constructor(private readonly options: CliOptions) {}

  async run(arguments_: string[]): Promise<void> {
    const [command, ...argumentsRest] = arguments_;
    if (command === "login") {
      await this.login(argumentsRest);
      return;
    }
    if (command === "logout") {
      await this.logout();
      return;
    }
    if (command === "start") {
      await this.start();
      return;
    }
    if (command === "stop") {
      await this.stop();
      return;
    }
    if (command === "status") {
      await this.status();
      return;
    }
    if (command === "doctor") {
      await this.doctor();
      return;
    }
    if (command === "capabilities") {
      const probe = this.options.probe();
      this.options.output(
        JSON.stringify({
          capabilities: probe.capabilities,
          environment: probe.environment,
        }),
      );
      return;
    }
    throw new Error(`Unknown runner command: ${command ?? ""}`);
  }

  private async login(arguments_: string[]): Promise<void> {
    const [serverUrl, name] = arguments_;
    if (!serverUrl || !name) {
      throw new Error("Usage: llm-bench-runner login <server-url> <name>");
    }
    const keys = this.options.keyPair();
    const probe = this.options.probe();
    const pairing = await this.options.pairing.start({
      serverUrl,
      name,
      publicKey: keys.publicKey,
      capabilities: probe.capabilities,
      environment: probe.environment,
    });
    this.options.output(
      `Open ${pairing.verificationUri} and enter ${pairing.userCode}`,
    );
    for (;;) {
      const result = await this.options.pairing.poll(
        serverUrl,
        pairing.deviceCode,
      );
      if (result.status === "approved") {
        await this.options.state.saveCredentials({
          serverUrl,
          runnerId: result.runnerId,
          token: result.token,
          ...keys,
        });
        this.options.output(`Runner ${name} paired.`);
        return;
      }
      if (new Date(pairing.expiresAt) <= new Date()) {
        throw new Error("Pairing code has expired.");
      }
      await this.options.sleep(pairing.intervalSeconds * 1000);
    }
  }

  private async logout(): Promise<void> {
    const credentials = await this.requiredCredentials();
    await this.options.transport(credentials).logout(credentials.runnerId);
    await this.options.state.clearCredentials();
    this.options.output("Runner logged out.");
  }

  private async start(): Promise<void> {
    const credentials = await this.requiredCredentials();
    const existing = await this.options.state.processId();
    if (existing && this.options.lifecycle.isRunning(existing)) {
      throw new Error(`Runner is already running (pid ${existing}).`);
    }
    const pid = await this.options.lifecycle.start(credentials);
    await this.options.state.saveProcessId(pid);
    this.options.output(`Runner started (pid ${pid}).`);
  }

  private async stop(): Promise<void> {
    const pid = await this.options.state.processId();
    if (pid && this.options.lifecycle.isRunning(pid)) {
      await this.options.lifecycle.stop(pid);
    }
    await this.options.state.clearProcessId();
    this.options.output("Runner stopped.");
  }

  private async status(): Promise<void> {
    const pid = await this.options.state.processId();
    if (pid && this.options.lifecycle.isRunning(pid)) {
      this.options.output(`Runner running (pid ${pid}).`);
      return;
    }
    if (pid) await this.options.state.clearProcessId();
    this.options.output("Runner stopped.");
  }

  private async doctor(): Promise<void> {
    const probe = this.options.probe();
    if (probe.issues.length > 0) {
      throw new Error(`Doctor found issues: ${probe.issues.join("; ")}`);
    }
    const credentials = await this.requiredCredentials();
    await this.options.transport(credentials).heartbeat();
    this.options.output("Doctor: healthy.");
  }

  private async requiredCredentials(): Promise<RunnerCredentials> {
    const credentials = await this.options.state.credentials();
    if (!credentials) throw new Error("Runner is not logged in.");
    return credentials;
  }
}
