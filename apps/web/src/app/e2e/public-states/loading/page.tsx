import { notFound } from "next/navigation";
import ResultsLoading from "@/app/results/loading";

export default function E2ePublicResultsLoadingPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ResultsLoading />;
}
