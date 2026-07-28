import type {
  Capability,
  RunnerEnvironment,
  RunnerInventory,
  RunnerPairingPollResponse,
  RunnerPairingStartResponse,
} from "@llm-bench/contracts";

import type { RunnerCredentials, RunnerStateStore } from "./state";

export type RunnerCapability = Capability;

export interface CapabilityProbe {
  capabilities: RunnerCapability[];
  environment: RunnerEnvironment;
  inventory: RunnerInventory;
  issues: string[];
}

export interface RunnerExtensionOperations {
  inventory(): Promise<RunnerInventory>;
  plugin: {
    add(argv: [string, ...string[]]): Promise<unknown>;
    remove(id: string): Promise<void>;
    list(): Promise<unknown>;
    probe(argv: [string, ...string[]]): Promise<unknown>;
    grant(id: string, pluginName: string, runnerName: string): Promise<void>;
    revoke(id: string, pluginName: string): Promise<void>;
  };
  mcp: {
    add(profilePath: string): Promise<void>;
    remove(id: string): Promise<void>;
    list(): Promise<unknown>;
    probe(id: string): Promise<unknown>;
    stop(id: string): Promise<void>;
  };
}

interface CliOptions {
  state: RunnerStateStore;
  output(line: string): void;
  keyPair(): Promise<{ publicKey: string; privateKey: string }>;
  probe(): CapabilityProbe;
  pairing: {
    start(input: {
      serverUrl: string;
      name: string;
      publicKey: string;
      capabilities: RunnerCapability[];
      inventory: RunnerInventory;
      environment: RunnerEnvironment;
    }): Promise<RunnerPairingStartResponse>;
    poll(
      serverUrl: string,
      deviceCode: string,
    ): Promise<RunnerPairingPollResponse>;
  };
  transport(
    credentials: RunnerCredentials,
    inventory: RunnerInventory,
  ): {
    logout(runnerId: string): Promise<void>;
    heartbeat(): Promise<void>;
  };
  lifecycle: {
    start(credentials: RunnerCredentials): Promise<number>;
    stop(pid: number): Promise<void>;
    isRunning(pid: number): boolean;
  };
  sleep(milliseconds: number): Promise<void>;
  extensions?: RunnerExtensionOperations;
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
          inventory: await this.inventory(),
          environment: probe.environment,
        }),
      );
      return;
    }
    if (command === "plugin") {
      await this.plugin(argumentsRest);
      return;
    }
    if (command === "mcp") {
      await this.mcp(argumentsRest);
      return;
    }
    throw new Error(`Unknown runner command: ${command ?? ""}`);
  }

  private async login(arguments_: string[]): Promise<void> {
    const [serverUrl, name] = arguments_;
    if (!serverUrl || !name) {
      throw new Error("Usage: llm-bench-runner login <server-url> <name>");
    }
    const keys = await this.options.keyPair();
    const probe = this.requireHealthyProbe();
    const pairing = await this.options.pairing.start({
      serverUrl,
      name,
      publicKey: keys.publicKey,
      capabilities: probe.capabilities,
      inventory: await this.inventory(),
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
    await this.options
      .transport(credentials, await this.inventory())
      .logout(credentials.runnerId);
    await this.options.state.clearCredentials();
    this.options.output("Runner logged out.");
  }

  private async start(): Promise<void> {
    const credentials = await this.requiredCredentials();
    this.requireHealthyProbe();
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
    await this.options
      .transport(credentials, await this.inventory())
      .heartbeat();
    this.options.output("Doctor: healthy.");
  }

  private async requiredCredentials(): Promise<RunnerCredentials> {
    const credentials = await this.options.state.credentials();
    if (!credentials) throw new Error("Runner is not logged in.");
    return credentials;
  }

  private requireHealthyProbe(): CapabilityProbe {
    const probe = this.options.probe();
    if (probe.issues.length > 0) {
      throw new Error(
        `Runner prerequisites failed: ${probe.issues.join("; ")}`,
      );
    }
    return probe;
  }

  private async inventory(): Promise<RunnerInventory> {
    if (this.options.extensions === undefined) {
      return { plugins: [], mcpProfiles: [] };
    }
    return this.options.extensions.inventory();
  }

  private async plugin(arguments_: string[]): Promise<void> {
    const extensions = this.requiredExtensions();
    const [command, ...rest] = arguments_;
    if (command === "list") {
      this.options.output(JSON.stringify(await extensions.plugin.list()));
      return;
    }
    if (command === "add" || command === "probe") {
      const [executable, ...argv] = rest;
      if (!executable) {
        throw new Error(
          `Usage: llm-bench-runner plugin ${command} <executable> [arguments...]`,
        );
      }
      const result = await extensions.plugin[command]([executable, ...argv]);
      this.options.output(JSON.stringify(result));
      return;
    }
    if (command === "remove") {
      const [id] = rest;
      if (!id) throw new Error("Usage: llm-bench-runner plugin remove <id>");
      await extensions.plugin.remove(id);
      this.options.output(`Plugin ${id} removed.`);
      return;
    }
    if (command === "grant") {
      const [id, pluginName, runnerName] = rest;
      if (!id || !pluginName || !runnerName) {
        throw new Error(
          "Usage: llm-bench-runner plugin grant <id> <plugin-name> <runner-env-name>",
        );
      }
      await extensions.plugin.grant(id, pluginName, runnerName);
      this.options.output(`Plugin ${id} grant ${pluginName} saved.`);
      return;
    }
    if (command === "revoke") {
      const [id, pluginName] = rest;
      if (!id || !pluginName) {
        throw new Error(
          "Usage: llm-bench-runner plugin revoke <id> <plugin-name>",
        );
      }
      await extensions.plugin.revoke(id, pluginName);
      this.options.output(`Plugin ${id} grant ${pluginName} revoked.`);
      return;
    }
    throw new Error(`Unknown plugin command: ${command ?? ""}`);
  }

  private async mcp(arguments_: string[]): Promise<void> {
    const extensions = this.requiredExtensions();
    const [command, ...rest] = arguments_;
    if (command === "list") {
      this.options.output(JSON.stringify(await extensions.mcp.list()));
      return;
    }
    if (command === "add") {
      const [profilePath] = rest;
      if (!profilePath)
        throw new Error("Usage: llm-bench-runner mcp add <profile-json-path>");
      await extensions.mcp.add(profilePath);
      this.options.output("MCP profile added.");
      return;
    }
    if (command === "remove") {
      const [id] = rest;
      if (!id) throw new Error("Usage: llm-bench-runner mcp remove <id>");
      await extensions.mcp.remove(id);
      this.options.output(`MCP profile ${id} removed.`);
      return;
    }
    if (
      command === "probe" ||
      command === "start" ||
      command === "capabilities"
    ) {
      const [id] = rest;
      if (!id) throw new Error(`Usage: llm-bench-runner mcp ${command} <id>`);
      const result = await extensions.mcp.probe(id);
      this.options.output(JSON.stringify(result));
      return;
    }
    if (command === "stop") {
      const [id] = rest;
      if (!id) throw new Error("Usage: llm-bench-runner mcp stop <id>");
      await extensions.mcp.stop(id);
      this.options.output(`MCP profile ${id} stopped.`);
      return;
    }
    throw new Error(`Unknown MCP command: ${command ?? ""}`);
  }

  private requiredExtensions(): RunnerExtensionOperations {
    if (this.options.extensions === undefined) {
      throw new Error("Runner extension management is unavailable.");
    }
    return this.options.extensions;
  }
}
