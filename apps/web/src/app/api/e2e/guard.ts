import { timingSafeEqual } from "node:crypto";

export const E2E_TOKEN_HEADER = "x-llm-bench-e2e-token";

export function rejectUnauthorizedE2eRequest(
  request: Request,
): Response | null {
  const expected = process.env.LLMBENCH_E2E_TOKEN;
  const supplied = request.headers.get(E2E_TOKEN_HEADER);
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LLMBENCH_E2E_ENABLED !== "1" ||
    !expected ||
    expected.length < 32 ||
    !supplied ||
    !safeEqual(supplied, expected)
  ) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export function requireTestDatabaseUrl(connectionString: string): string {
  const databaseName = decodeURIComponent(
    new URL(connectionString).pathname.replace(/^\/+/, ""),
  );
  if (
    !/^(?:test_[a-z0-9][a-z0-9_-]*|[a-z0-9][a-z0-9_-]*_test)$/iu.test(
      databaseName,
    )
  ) {
    throw new Error("E2E route requires a test-named database.");
  }
  return connectionString;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
