import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsClient } from "./results-client";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage() {
  return (
    <Suspense>
      <ResultsClient />
    </Suspense>
  );
}
