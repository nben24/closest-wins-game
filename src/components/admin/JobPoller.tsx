"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** While open, keeps advancing the job (one bounded step batch per request) and refreshes the page. */
export function JobPoller({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(true);
  useEffect(() => {
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          const res = await fetch(`/api/admin/jobs/${jobId}/advance`, { method: "POST" });
          const data = (await res.json()) as { status?: string };
          router.refresh();
          if (!res.ok || !data.status || !["queued", "running"].includes(data.status)) break;
        } catch {
          await new Promise((r) => setTimeout(r, 5000));
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!stop) setWorking(false);
    })();
    return () => {
      stop = true;
    };
  }, [jobId, router]);
  return working ? (
    <span className="flex items-center gap-2 text-sm text-ink-soft" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-coral motion-reduce:animate-none" aria-hidden="true" /> Working…
    </span>
  ) : null;
}
