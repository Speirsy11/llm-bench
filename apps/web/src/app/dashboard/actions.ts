"use server";

import { revalidatePath } from "next/cache";

import { SealedCredentialSchema } from "@llm-bench/contracts";

import { getDashboardActor } from "./auth";
import { validateMaskedSecret } from "./credential-input";
import {
  dashboardMatrixForHarness,
  selectedDashboardModelRoutes,
} from "./matrix";
import { getDashboardControlPlane } from "./runtime";

export async function saveCredentialProfileAction(formData: FormData) {
  const actor = await getDashboardActor();
  const runnerId = requiredString(formData, "runnerId");
  const sealedCredential = SealedCredentialSchema.parse({
    algorithm: requiredString(formData, "algorithm"),
    runnerId,
    keyFingerprint: requiredString(formData, "keyFingerprint"),
    ciphertext: requiredString(formData, "ciphertext"),
  });
  await getDashboardControlPlane().dashboard.saveCredentialProfile(actor, {
    label: requiredString(formData, "label"),
    provider: requiredString(formData, "provider"),
    runnerId,
    maskedSecret: validateMaskedSecret(
      requiredString(formData, "maskedSecret"),
    ),
    sealedCredential,
  });
  revalidatePath("/dashboard");
}

export async function launchExperimentAction(formData: FormData) {
  const actor = await getDashboardActor();
  const harnessId = requiredString(formData, "harness");
  const matrix = dashboardMatrixForHarness(harnessId);
  const selectedRoutes =
    harnessId === "llmbench"
      ? selectedDashboardModelRoutes(formData.getAll("modelRoute").map(String))
      : matrix.modelRoutes;
  await getDashboardControlPlane().dashboard.launchExperiment(actor, {
    name: requiredString(formData, "name"),
    runnerId: requiredString(formData, "runnerId"),
    ...(harnessId === "llmbench"
      ? {
          credentialProfileId: requiredString(formData, "credentialProfileId"),
        }
      : {}),
    spendConfirmed: formData.get("spendConfirmed") === "on",
    modelRoutes: selectedRoutes,
    harnesses: matrix.harnesses,
    toolsets: matrix.toolsets,
  });
  revalidatePath("/dashboard");
}

export async function cancelJobAction(formData: FormData) {
  const actor = await getDashboardActor();
  await getDashboardControlPlane().dashboard.cancelJob(
    actor,
    requiredString(formData, "jobId"),
  );
  revalidatePath("/dashboard");
}

export async function retryJobAction(formData: FormData) {
  const actor = await getDashboardActor();
  await getDashboardControlPlane().dashboard.retryJob(
    actor,
    requiredString(formData, "jobId"),
  );
  revalidatePath("/dashboard");
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}
