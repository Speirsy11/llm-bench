export interface McpProfileMetadata {
  protocolVersion: "1";
  id: string;
  version: string;
  contentHash: string;
  label: string;
  description?: string;
  capabilities: string[];
  tools: string[];
}

export interface McpProfileLocalConfig {
  argv: [string, ...string[]];
  cwd?: string;
  secretReferences: Record<string, string>;
}

export interface McpProfile {
  metadata: McpProfileMetadata;
  local: McpProfileLocalConfig;
}

export interface McpProfileInput {
  metadata: Omit<McpProfileMetadata, "contentHash"> & {
    contentHash?: string;
  };
  local: McpProfileLocalConfig;
}

export type SecretResolver = (reference: string) => Promise<string | undefined>;

export interface McpSessionOptions {
  maxOutputBytes?: number;
  signal?: AbortSignal;
  startupTimeoutMs?: number;
}

export interface McpProbeResult {
  capabilities: Record<string, unknown>;
  protocolVersion?: string;
}
