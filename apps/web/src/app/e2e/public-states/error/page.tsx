import { notFound } from "next/navigation";

import { E2ePublicResultsErrorState } from "./error-state";

export default function E2ePublicResultsErrorPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <E2ePublicResultsErrorState />;
}
