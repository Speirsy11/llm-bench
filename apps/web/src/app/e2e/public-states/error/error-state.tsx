"use client";

import ResultsError from "@/app/results/error";

export function E2ePublicResultsErrorState() {
  return <ResultsError reset={() => window.location.reload()} />;
}
