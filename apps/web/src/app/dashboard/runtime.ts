import { parseWebEnv } from "@/env";

import { createControlPlane } from "@llm-bench/control-plane";

const env = parseWebEnv(process.env);

export const dashboardControlPlane = createControlPlane({
  connectionString: env.databaseUrl,
});
