"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

import type { AuthContext } from "@llm-bench/control-plane";

import { defaultDashboardMatrix, selectedDashboardModelRoutes } from "./matrix";
import { dashboardControlPlane } from "./runtime";

export async function saveCredentialProfileAction(formData: FormData) {
  const actor = await requireActor();
  const runnerId = requiredString(formData, "runnerId");
  await dashboardControlPlane.dashboard.saveCredentialProfile(actor, {
    label: requiredString(formData, "label"),
    provider: requiredString(formData, "provider"),
    runnerId,
    maskedSecret: requiredString(formData, "maskedSecret"),
    sealedCredential: {
      algorithm: "x25519-xsalsa20-poly1305-sealed-box",
      runnerId,
      keyFingerprint: requiredString(formData, "keyFingerprint"),
      ciphertext: requiredString(formData, "ciphertext"),
    },
  });
  revalidatePath("/dashboard");
}

export async function launchExperimentAction(formData: FormData) {
  const actor = await requireActor();
  const matrix = defaultDashboardMatrix();
  const selectedRoutes = selectedDashboardModelRoutes(
    formData.getAll("modelRoute").map(String),
  );
  await dashboardControlPlane.dashboard.launchExperiment(actor, {
    name: requiredString(formData, "name"),
    runnerId: requiredString(formData, "runnerId"),
    credentialProfileId: requiredString(formData, "credentialProfileId"),
    spendConfirmed: formData.get("spendConfirmed") === "on",
    modelRoutes: selectedRoutes,
    harnesses: matrix.harnesses,
    toolsets: matrix.toolsets,
  });
  revalidatePath("/dashboard");
}

export async function cancelJobAction(formData: FormData) {
  const actor = await requireActor();
  await dashboardControlPlane.dashboard.cancelJob(
    actor,
    requiredString(formData, "jobId"),
  );
  revalidatePath("/dashboard");
}

export async function retryJobAction(formData: FormData) {
  const actor = await requireActor();
  await dashboardControlPlane.dashboard.retryJob(
    actor,
    requiredString(formData, "jobId"),
  );
  revalidatePath("/dashboard");
}

async function requireActor(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user.id || !session.user.githubLogin) {
    redirect("/api/auth/signin?callbackUrl=%2Fdashboard");
  }
  return {
    userId: session.user.id,
    githubLogin: session.user.githubLogin,
    isAdmin: false,
  };
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}
