import { parseWebEnv } from "@/env";
import { get } from "@vercel/blob";

import {
  createControlPlane,
  PublicArtifactReader,
} from "@llm-bench/control-plane";

type DashboardControlPlane = ReturnType<typeof createControlPlane>;

let dashboardControlPlane: DashboardControlPlane | null = null;
let shutdownRegistered = false;

export function getDashboardControlPlane(): DashboardControlPlane {
  if (!dashboardControlPlane) {
    const env = parseWebEnv(process.env);
    dashboardControlPlane = createControlPlane({
      connectionString: env.databaseUrl,
      artifactReader: new VercelPrivateArtifactReader(),
    });
    registerShutdown();
  }
  return dashboardControlPlane;
}

class VercelPrivateArtifactReader extends PublicArtifactReader {
  async read(pathname: string): Promise<Uint8Array> {
    const result = await get(pathname, { access: "private" });
    if (result?.statusCode !== 200) {
      throw new Error("Private artifact is unavailable.");
    }
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }
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
