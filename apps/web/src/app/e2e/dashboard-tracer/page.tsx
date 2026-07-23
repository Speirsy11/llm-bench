import { notFound, redirect } from "next/navigation";

export default function E2eDashboardTracerPage() {
  if (process.env.NODE_ENV === "production") notFound();
  redirect("/dashboard");
}
