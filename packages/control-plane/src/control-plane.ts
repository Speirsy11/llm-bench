import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { AuthContext } from "./access-policy";
import type { PublicArtifactReader } from "./public-results";
import type { Experiment, User } from "./schema";
import { canReadExperiment } from "./access-policy";
import { createDashboardExperimentService } from "./dashboard-experiments";
import { createDatabase } from "./database";
import { createPublicResultService } from "./public-results";
import { experiments, users } from "./schema";

export interface GitHubIdentityInput {
  readonly githubId: string;
  readonly githubLogin: string;
  readonly name?: string;
  readonly email?: string;
  readonly image?: string;
}

export interface CreateExperimentInput {
  readonly name: string;
}

export function createControlPlane({
  connectionString,
  artifactReader,
}: {
  readonly connectionString: string;
  readonly artifactReader?: PublicArtifactReader;
}) {
  const database = createDatabase(connectionString);
  const dashboard = createDashboardExperimentService(database.db);
  const publicResults = createPublicResultService(database.db, {
    artifactReader,
  });

  return {
    dashboard,
    publicResults,
    users: {
      async upsertGitHubIdentity(input: GitHubIdentityInput): Promise<User> {
        const [user] = await database.db
          .insert(users)
          .values({ id: randomUUID(), ...input })
          .onConflictDoUpdate({
            target: users.githubId,
            set: {
              githubLogin: input.githubLogin,
              name: input.name,
              email: input.email,
              image: input.image,
              updatedAt: new Date(),
            },
          })
          .returning();
        // PostgreSQL INSERT ... RETURNING always yields the inserted/upserted row.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return user!;
      },
    },
    experiments: {
      async create(
        actor: AuthContext,
        input: CreateExperimentInput,
      ): Promise<Experiment> {
        const [experiment] = await database.db
          .insert(experiments)
          .values({
            ownerId: actor.userId,
            name: input.name,
            visibility: "private",
          })
          .returning();
        // PostgreSQL INSERT ... RETURNING always yields the inserted row.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return experiment!;
      },
      async get(
        actor: AuthContext | null,
        experimentId: string,
      ): Promise<Experiment | null> {
        const experiment = await database.db.query.experiments.findFirst({
          where: eq(experiments.id, experimentId),
        });
        return experiment && canReadExperiment(actor, experiment)
          ? experiment
          : null;
      },
      async rename(
        actor: AuthContext,
        experimentId: string,
        name: string,
      ): Promise<Experiment> {
        const [renamed] = await database.db
          .update(experiments)
          .set({ name, updatedAt: new Date() })
          .where(
            and(
              eq(experiments.id, experimentId),
              eq(experiments.ownerId, actor.userId),
            ),
          )
          .returning();
        if (!renamed) {
          throw new Error("Experiment is unavailable.");
        }
        return renamed;
      },
    },
    close: database.close,
  };
}
