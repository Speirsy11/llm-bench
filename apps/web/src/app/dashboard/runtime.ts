import { parseWebEnv } from "@/env";

import { createControlPlane } from "@llm-bench/control-plane";

type DashboardControlPlane = ReturnType<typeof createControlPlane>;

let dashboardControlPlane: DashboardControlPlane | null = null;
let shutdownRegistered = false;

export function getDashboardControlPlane(): DashboardControlPlane {
  if (!dashboardControlPlane) {
    const env = parseWebEnv(process.env);
    dashboardControlPlane = createControlPlane({
      connectionString: env.databaseUrl,
    });
    registerShutdown();
  }
  return dashboardControlPlane;
}

function registerShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const closeControlPlane = () => {
    void dashboardControlPlane?.close();
    dashboardControlPlane = null;
  };
  process.once("SIGINT", closeControlPlane);
  process.once("SIGTERM", closeControlPlane);
}
