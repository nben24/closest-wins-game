"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/app/admin/actions";

/** Form wrapper for server actions that return {error|message}. */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClass = "btn-ink",
}: {
  action: (prev: FormState, f: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  submitLabel: string;
  submitClass?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className={`${submitClass} min-h-10 text-base`} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </button>
        {state.error && <p role="alert" className="text-sm font-semibold text-coral">{state.error}</p>}
        {state.message && <p role="status" className="text-sm font-semibold text-mint">{state.message}</p>}
      </div>
    </form>
  );
}
