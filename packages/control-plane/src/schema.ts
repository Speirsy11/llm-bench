import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const experimentVisibility = pgEnum("experiment_visibility", [
  "private",
  "public",
]);

export const runnerStatus = pgEnum("runner_status", [
  "offline",
  "online",
  "disabled",
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "leased",
  "preparing",
  "running",
  "grading",
  "uploading",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const users = pgTable(
  "users",
  {
    id: text().primaryKey(),
    name: text(),
    email: text(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text(),
    githubId: text("github_id").notNull(),
    githubLogin: text("github_login").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_github_id_unique").on(table.githubId),
    uniqueIndex("users_github_login_unique").on(table.githubLogin),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text(),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_index").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_index").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const runners = pgTable(
  "runners",
  {
    id: uuid().defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    publicKey: text("public_key").notNull(),
    protocolVersion: text("protocol_version").default("1.0").notNull(),
    tokenHash: text("token_hash"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    status: runnerStatus().default("offline").notNull(),
    capabilities: jsonb().$type<string[]>().default([]).notNull(),
    environment: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("runners_owner_id_index").on(table.ownerId),
    uniqueIndex("runners_token_hash_unique").on(table.tokenHash),
  ],
);

export const runnerPairings = pgTable(
  "runner_pairings",
  {
    deviceCodeHash: text("device_code_hash").primaryKey(),
    userCodeHash: text("user_code_hash").notNull(),
    request: jsonb().$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    runnerId: uuid("runner_id").references(() => runners.id, {
      onDelete: "cascade",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("runner_pairings_user_code_hash_unique").on(table.userCodeHash),
  ],
);

export const experiments = pgTable(
  "experiments",
  {
    id: uuid().defaultRandom().primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    visibility: experimentVisibility().default("private").notNull(),
    curatedAt: timestamp("curated_at", { withTimezone: true }),
    curatedBy: text("curated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("experiments_owner_id_index").on(table.ownerId),
    index("experiments_visibility_index").on(table.visibility),
  ],
);

export const targets = pgTable(
  "targets",
  {
    id: uuid().defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    modelRoute: jsonb("model_route").$type<Record<string, unknown>>().notNull(),
    harness: jsonb().$type<Record<string, unknown>>().notNull(),
    toolset: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("targets_experiment_position_unique").on(
      table.experimentId,
      table.position,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().defaultRandom().primaryKey(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    runnerId: uuid("runner_id").references(() => runners.id, {
      onDelete: "set null",
    }),
    status: jobStatus().default("queued").notNull(),
    benchmarkId: text("benchmark_id"),
    benchmarkVersion: text("benchmark_version"),
    requiredCapabilities: jsonb("required_capabilities")
      .$type<string[]>()
      .default([])
      .notNull(),
    queuePosition: integer("queue_position").generatedAlwaysAsIdentity(),
    cancellationRequested: boolean("cancellation_requested")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("jobs_experiment_id_index").on(table.experimentId),
    index("jobs_runner_status_index").on(table.runnerId, table.status),
  ],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid().defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    status: jobStatus().default("queued").notNull(),
    runnerId: uuid("runner_id").references(() => runners.id, {
      onDelete: "set null",
    }),
    leaseTokenHash: text("lease_token_hash"),
    checkpoint: jsonb().$type<Record<string, unknown>>(),
    terminal: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("attempts_job_number_unique").on(table.jobId, table.number),
    index("attempts_runner_status_index").on(table.runnerId, table.status),
  ],
);

export const runnerEvents = pgTable(
  "runner_events",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    event: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.attemptId, table.sequence] })],
);

export const results = pgTable(
  "results",
  {
    id: uuid().defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    benchmarkId: text("benchmark_id").notNull(),
    benchmarkVersion: text("benchmark_version").notNull(),
    primaryMetricId: text("primary_metric_id"),
    summary: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("results_attempt_id_unique").on(table.attemptId)],
);

export const metrics = pgTable(
  "metrics",
  {
    id: uuid().defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    metricId: text("metric_id").notNull(),
    kind: text().notNull(),
    unit: text().notNull(),
    direction: text().notNull(),
    value: numeric({ mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("metrics_result_metric_unique").on(
      table.resultId,
      table.metricId,
    ),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid().defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    blobPath: text("blob_path").notNull(),
    contentHash: text("content_hash").notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("artifacts_result_id_index").on(table.resultId)],
);

export type User = typeof users.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
