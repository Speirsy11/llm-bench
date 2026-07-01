import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAuthAdapter,
  createControlPlane,
  createDatabase,
  migrateDatabase,
  resetTestDatabase,
} from "./index";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for Postgres integration tests.",
  );
}

const controlPlane = createControlPlane({ connectionString });

beforeAll(async () => {
  await resetTestDatabase(connectionString);
  await migrateDatabase(connectionString);
});

afterAll(async () => {
  await controlPlane.close();
});

describe("experiment visibility", () => {
  it("returns public data to an anonymous visitor without exposing private data", async () => {
    const owner = await controlPlane.users.upsertGitHubIdentity({
      githubId: "1001",
      githubLogin: "owner",
      name: "Owner",
    });
    const actor = {
      userId: owner.id,
      githubLogin: owner.githubLogin,
      isAdmin: false,
    };

    const publicExperiment = await controlPlane.experiments.create(actor, {
      name: "Public comparison",
      visibility: "public",
    });
    const privateExperiment = await controlPlane.experiments.create(actor, {
      name: "Private comparison",
      visibility: "private",
    });

    await expect(
      controlPlane.experiments.get(null, publicExperiment.id),
    ).resolves.toMatchObject({ name: "Public comparison" });
    await expect(
      controlPlane.experiments.get(null, privateExperiment.id),
    ).resolves.toBeNull();
  });

  it("denies another user read and mutation access to a private experiment", async () => {
    const owner = await controlPlane.users.upsertGitHubIdentity({
      githubId: "2001",
      githubLogin: "private-owner",
      name: "Private Owner",
    });
    const otherUser = await controlPlane.users.upsertGitHubIdentity({
      githubId: "2002",
      githubLogin: "other-user",
      name: "Other User",
    });
    const ownerActor = {
      userId: owner.id,
      githubLogin: owner.githubLogin,
      isAdmin: false,
    };
    const otherActor = {
      userId: otherUser.id,
      githubLogin: otherUser.githubLogin,
      isAdmin: false,
    };
    const experiment = await controlPlane.experiments.create(ownerActor, {
      name: "Owner draft",
      visibility: "private",
    });

    await expect(
      controlPlane.experiments.get(otherActor, experiment.id),
    ).resolves.toBeNull();
    await expect(
      controlPlane.experiments.rename(otherActor, experiment.id, "Stolen"),
    ).rejects.toThrow("Experiment is unavailable.");
    await expect(
      controlPlane.experiments.rename(ownerActor, experiment.id, "Owner final"),
    ).resolves.toMatchObject({ name: "Owner final" });
    await expect(
      controlPlane.experiments.rename(
        ownerActor,
        "00000000-0000-0000-0000-000000000000",
        "Missing",
      ),
    ).rejects.toThrow("Experiment is unavailable.");
  });

  it("allows only an administrator to curate an experiment for public access", async () => {
    const owner = await controlPlane.users.upsertGitHubIdentity({
      githubId: "3001",
      githubLogin: "curation-owner",
      name: "Curation Owner",
    });
    const administrator = await controlPlane.users.upsertGitHubIdentity({
      githubId: "3002",
      githubLogin: "octoadmin",
      name: "Administrator",
    });
    const ownerActor = {
      userId: owner.id,
      githubLogin: owner.githubLogin,
      isAdmin: false,
    };
    const adminActor = {
      userId: administrator.id,
      githubLogin: administrator.githubLogin,
      isAdmin: true,
    };
    const experiment = await controlPlane.experiments.create(ownerActor, {
      name: "Candidate result",
      visibility: "private",
    });

    await expect(
      controlPlane.experiments.publishCurated(ownerActor, experiment.id),
    ).rejects.toThrow("Administrator access required.");
    await expect(
      controlPlane.experiments.publishCurated(adminActor, experiment.id),
    ).resolves.toMatchObject({
      visibility: "public",
      curatedBy: administrator.id,
    });
    await expect(
      controlPlane.experiments.get(null, experiment.id),
    ).resolves.toMatchObject({ name: "Candidate result" });
    await expect(
      controlPlane.experiments.publishCurated(
        adminActor,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow("Experiment is unavailable.");
  });
});

describe("database migrations", () => {
  it("creates the complete control-plane schema on an empty database", async () => {
    const sql = postgres(connectionString, { max: 1 });
    try {
      const rows = await sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `;

      expect(rows.map((row) => row.table_name)).toEqual([
        "accounts",
        "artifacts",
        "attempts",
        "experiments",
        "jobs",
        "metrics",
        "results",
        "runner_events",
        "runner_pairings",
        "runners",
        "sessions",
        "targets",
        "users",
        "verification_tokens",
      ]);
    } finally {
      await sql.end();
    }
  });
});

describe("Auth.js database sessions", () => {
  it("stores, resolves, and revokes a GitHub user's session", async () => {
    const database = createDatabase(connectionString);
    const adapter = createAuthAdapter(database.db);
    try {
      const userInput = {
        id: "github-4001",
        name: "Session User",
        email: "session@example.com",
        emailVerified: null,
        image: null,
        githubId: "4001",
        githubLogin: "session-user",
      } as Parameters<NonNullable<typeof adapter.createUser>>[0];
      const user = await adapter.createUser?.(userInput);
      if (!user) {
        throw new Error("Auth adapter did not create a user.");
      }
      await adapter.createSession?.({
        sessionToken: "session-token-4001",
        userId: user.id,
        expires: new Date("2030-01-01T00:00:00.000Z"),
      });

      await expect(
        adapter.getSessionAndUser?.("session-token-4001"),
      ).resolves.toMatchObject({
        session: { userId: "github-4001" },
        user: { id: "github-4001", name: "Session User" },
      });

      await adapter.deleteSession?.("session-token-4001");
      await expect(
        adapter.getSessionAndUser?.("session-token-4001"),
      ).resolves.toBeNull();
    } finally {
      await database.close();
    }
  });

  it("rejects a second identity with the same non-null email", async () => {
    const database = createDatabase(connectionString);
    const adapter = createAuthAdapter(database.db);
    try {
      const first = {
        id: "github-5001",
        name: "First Identity",
        email: "unique@example.com",
        emailVerified: null,
        image: null,
        githubId: "5001",
        githubLogin: "first-identity",
      } as Parameters<NonNullable<typeof adapter.createUser>>[0];
      const duplicate = {
        ...first,
        id: "github-5002",
        name: "Duplicate Identity",
        githubId: "5002",
        githubLogin: "duplicate-identity",
      } as Parameters<NonNullable<typeof adapter.createUser>>[0];

      await adapter.createUser?.(first);
      await expect(adapter.createUser?.(duplicate)).rejects.toMatchObject({
        cause: { code: "23505" },
      });
    } finally {
      await database.close();
    }
  });
});
