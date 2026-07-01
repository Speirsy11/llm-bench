import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { RunnerPairingStartRequest } from "@llm-bench/contracts";

import type { AuthContext } from "./access-policy";

const PAIRING_LIFETIME_MS = 10 * 60 * 1000;

export interface RunnerPairingRecord {
  deviceCodeHash: string;
  userCodeHash: string;
  request: RunnerPairingStartRequest;
  expiresAt: Date;
  ownerId: string | null;
  runnerId: string | null;
  consumed: boolean;
}

export interface PairedRunner {
  id: string;
  ownerId: string;
  name: string;
  publicKey: string;
  capabilities: RunnerPairingStartRequest["capabilities"];
  environment: RunnerPairingStartRequest["environment"];
  tokenHash: string;
  revokedAt: Date | null;
  status: "offline" | "online" | "disabled";
  lastSeenAt: Date | null;
}

export interface RunnerProtocolStore {
  savePairing(record: RunnerPairingRecord): Promise<void>;
  findPairingByUserCodeHash(
    userCodeHash: string,
  ): Promise<RunnerPairingRecord | null>;
  findPairingByDeviceHash(
    deviceCodeHash: string,
  ): Promise<RunnerPairingRecord | null>;
  findRunnerByTokenHash(tokenHash: string): Promise<PairedRunner | null>;
  findRunnerById(runnerId: string): Promise<PairedRunner | null>;
  revokeRunner(runnerId: string, revokedAt: Date): Promise<void>;
  recordHeartbeat(runnerId: string, lastSeenAt: Date): Promise<void>;
  approvePairing(
    pairing: RunnerPairingRecord,
    runner: PairedRunner,
  ): Promise<boolean>;
  consumePairing(
    pairing: RunnerPairingRecord,
    runner: PairedRunner,
    consumedAt: Date,
  ): Promise<boolean>;
}

export interface InMemoryRunnerProtocolStore extends RunnerProtocolStore {
  inspect(): unknown;
}

export function createInMemoryRunnerProtocolStore(): InMemoryRunnerProtocolStore {
  const pairings: RunnerPairingRecord[] = [];
  const runners: PairedRunner[] = [];
  return {
    savePairing(record) {
      pairings.push(record);
      return Promise.resolve();
    },
    findPairingByUserCodeHash(userCodeHash) {
      return Promise.resolve(
        pairings.find((record) => record.userCodeHash === userCodeHash) ?? null,
      );
    },
    findPairingByDeviceHash(deviceCodeHash) {
      return Promise.resolve(
        pairings.find((record) => record.deviceCodeHash === deviceCodeHash) ??
          null,
      );
    },
    findRunnerByTokenHash(tokenHash) {
      return Promise.resolve(
        runners.find((runner) => runner.tokenHash === tokenHash) ?? null,
      );
    },
    findRunnerById(runnerId) {
      return Promise.resolve(
        runners.find((runner) => runner.id === runnerId) ?? null,
      );
    },
    revokeRunner(runnerId, revokedAt) {
      const runner = requiredInMemoryRunner(runners, runnerId);
      runner.revokedAt = revokedAt;
      runner.status = "disabled";
      return Promise.resolve();
    },
    recordHeartbeat(runnerId, lastSeenAt) {
      const runner = requiredInMemoryRunner(runners, runnerId);
      if (runner.revokedAt === null) {
        runner.status = "online";
        runner.lastSeenAt = lastSeenAt;
      }
      return Promise.resolve();
    },
    approvePairing(pairing, runner) {
      const current = pairings.find(
        (candidate) => candidate.deviceCodeHash === pairing.deviceCodeHash,
      );
      if (current?.ownerId !== null) return Promise.resolve(false);
      current.ownerId = pairing.ownerId;
      current.runnerId = runner.id;
      runners.push(runner);
      return Promise.resolve(true);
    },
    consumePairing(pairing, runner, consumedAt) {
      const current = pairings.find(
        (candidate) => candidate.deviceCodeHash === pairing.deviceCodeHash,
      );
      if (
        !current ||
        current.consumed ||
        current.runnerId !== runner.id ||
        current.expiresAt <= consumedAt
      ) {
        return Promise.resolve(false);
      }
      current.consumed = true;
      runners.splice(
        runners.findIndex((candidate) => candidate.id === runner.id),
        1,
        runner,
      );
      return Promise.resolve(true);
    },
    inspect() {
      return { pairings, runners };
    },
  };
}

function requiredInMemoryRunner(
  runners: PairedRunner[],
  runnerId: string,
): PairedRunner {
  const runner = runners.find((candidate) => candidate.id === runnerId);
  if (!runner) throw new Error("Runner is unavailable.");
  return runner;
}

export function createRunnerProtocolService({
  store,
  now = () => new Date(),
  randomToken = () => randomBytes(32).toString("base64url"),
}: {
  store: RunnerProtocolStore;
  now?: () => Date;
  randomToken?: () => string;
}) {
  return {
    async startPairing(request: RunnerPairingStartRequest) {
      const deviceCode = randomToken();
      const userCode = randomToken();
      const expiresAt = new Date(now().getTime() + PAIRING_LIFETIME_MS);
      await store.savePairing({
        deviceCodeHash: hashSecret(deviceCode),
        userCodeHash: hashSecret(userCode),
        request,
        expiresAt,
        ownerId: null,
        runnerId: null,
        consumed: false,
      });
      return { deviceCode, userCode, expiresAt, intervalSeconds: 2 };
    },

    async approvePairing(actor: AuthContext, userCode: string) {
      const pairing = await store.findPairingByUserCodeHash(
        hashSecret(userCode),
      );
      assertPairingUsable(pairing, now());
      if (pairing.ownerId !== null) {
        throw new Error("Pairing code has already been approved.");
      }
      const runner: PairedRunner = {
        id: randomUUID(),
        ownerId: actor.userId,
        name: pairing.request.name,
        publicKey: pairing.request.publicKey,
        capabilities: pairing.request.capabilities,
        environment: pairing.request.environment,
        tokenHash: "",
        revokedAt: null,
        status: "offline",
        lastSeenAt: null,
      };
      const approvedPairing = {
        ...pairing,
        ownerId: actor.userId,
        runnerId: runner.id,
      };
      if (!(await store.approvePairing(approvedPairing, runner))) {
        throw new Error("Pairing code has already been approved.");
      }
      return { runnerId: runner.id };
    },

    async pollPairing(deviceCode: string) {
      const pairing = await store.findPairingByDeviceHash(
        hashSecret(deviceCode),
      );
      assertPairingUsable(pairing, now());
      if (!pairing.runnerId) {
        return { status: "pending" as const };
      }
      const runner = await store.findRunnerById(pairing.runnerId);
      if (!runner) throw new Error("Paired runner is unavailable.");
      const token = randomToken();
      const runnerWithToken = { ...runner, tokenHash: hashSecret(token) };
      if (!(await store.consumePairing(pairing, runnerWithToken, now()))) {
        throw new Error("Pairing code has already been consumed.");
      }
      const response = {
        status: "approved" as const,
        runnerId: pairing.runnerId,
        token,
      };
      return response;
    },

    async authenticate(token: string): Promise<PairedRunner> {
      const tokenHash = hashSecret(token);
      const runner = await store.findRunnerByTokenHash(tokenHash);
      if (
        runner?.revokedAt !== null ||
        !safeEqual(runner.tokenHash, tokenHash)
      ) {
        throw new Error("Runner authentication failed.");
      }
      return runner;
    },

    async revokeRunner(actor: AuthContext, runnerId: string): Promise<void> {
      const runner = await store.findRunnerById(runnerId);
      if (!runner || runner.ownerId !== actor.userId) {
        throw new Error("Runner is unavailable.");
      }
      await store.revokeRunner(runner.id, now());
    },

    async revokeAuthenticated(runner: PairedRunner): Promise<void> {
      await store.revokeRunner(runner.id, now());
    },

    async heartbeat(runner: PairedRunner): Promise<void> {
      await store.recordHeartbeat(runner.id, now());
    },
  };
}

function assertPairingUsable(
  pairing: RunnerPairingRecord | null,
  now: Date,
): asserts pairing is RunnerPairingRecord {
  if (!pairing) throw new Error("Pairing code is invalid.");
  if (pairing.consumed) {
    throw new Error("Pairing code has already been consumed.");
  }
  if (pairing.expiresAt <= now) throw new Error("Pairing code has expired.");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
