import { notFound } from "next/navigation";

import { FixtureDashboardTracer } from "./tracer";

export default function E2eDashboardTracerPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FixtureDashboardTracer />;
}
