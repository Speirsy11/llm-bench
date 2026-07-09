import { redirect } from "next/navigation";
import { auth } from "@/auth";

import type { AuthContext } from "@llm-bench/control-plane";

export async function getDashboardActorSession() {
  const session = await auth();
  if (!session?.user.id || !session.user.githubLogin) {
    redirect("/api/auth/signin?callbackUrl=%2Fdashboard");
  }
  return {
    session,
    actor: {
      userId: session.user.id,
      githubLogin: session.user.githubLogin,
      isAdmin: false,
    } satisfies AuthContext,
  };
}

export async function getDashboardActor(): Promise<AuthContext> {
  return (await getDashboardActorSession()).actor;
}
