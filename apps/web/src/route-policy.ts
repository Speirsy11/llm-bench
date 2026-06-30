import type { AuthContext } from "@llm-bench/control-plane";

export type RouteAccess =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly location: string };

/** Keep the public catalog open while gating every dashboard route. */
export function resolveRouteAccess(
  pathname: string,
  actor: AuthContext | null,
): RouteAccess {
  if (pathname.startsWith("/dashboard") && !actor) {
    return {
      kind: "redirect",
      location: `/api/auth/signin?callbackUrl=${encodeURIComponent(pathname)}`,
    };
  }
  return { kind: "allow" };
}
