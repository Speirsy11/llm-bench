import type { HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { handleUpload } from "@vercel/blob/client";

import {
  authorizeRunnerBlobUpload,
  handleRunnerRequest,
  runnerProtocol,
} from "../runtime";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return dispatch(request, context);
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return dispatch(request, context);
}

async function dispatch(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  if (request.method === "POST" && path.join("/") === "artifacts/upload") {
    try {
      const body = (await request.json()) as HandleUploadBody;
      const result = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const payload = JSON.parse(clientPayload ?? "") as {
            runnerToken: string;
            attemptId: string;
            leaseToken: string;
            contentHash: string;
            byteLength: number;
          };
          const authorization = await authorizeRunnerBlobUpload({
            ...payload,
            pathname,
          });
          return {
            allowedContentTypes: [
              "application/octet-stream",
              "application/json",
              "text/plain",
              "text/x-diff",
            ],
            maximumSizeInBytes: authorization.maximumSizeInBytes,
            addRandomSuffix: false,
            allowOverwrite: true,
            tokenPayload: JSON.stringify({
              runnerId: authorization.runnerId,
              attemptId: payload.attemptId,
            }),
          };
        },
        onUploadCompleted: () => Promise.resolve(),
      });
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Upload failed." },
        { status: statusForRunnerUploadError(error) },
      );
    }
  }
  if (request.method === "POST" && path.join("/") === "pairings/approve") {
    const session = await auth();
    if (!session?.user) {
      return Response.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }
    try {
      const body = (await request.json()) as { userCode?: unknown };
      if (typeof body.userCode !== "string" || body.userCode.length === 0) {
        return Response.json(
          { error: "Pairing code is required." },
          { status: 400 },
        );
      }
      const result = await runnerProtocol.approvePairing(
        {
          userId: session.user.id,
          githubLogin: session.user.githubLogin,
          isAdmin: false,
        },
        body.userCode,
      );
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Pairing failed." },
        { status: 400 },
      );
    }
  }
  return handleRunnerRequest(request, path);
}

function statusForRunnerUploadError(error: unknown): number {
  if (!(error instanceof Error)) return 500;
  if (
    error.message === "Artifact upload is invalid." ||
    error instanceof SyntaxError
  ) {
    return 400;
  }
  if (
    error.message === "Runner authentication failed." ||
    error.message === "Attempt lease is unavailable."
  ) {
    return 401;
  }
  return 500;
}
