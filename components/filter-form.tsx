"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

/** A GET filter form that updates the URL on change (selects) or submit (text), so filter state is shareable. */
export default function FilterForm({ action, children, className }: { action: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const push = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) if (typeof v === "string" && v.trim() !== "") params.set(k, v.trim());
    router.push(`${action}${params.size ? `?${params}` : ""}`);
  };
  return (
    <form
      ref={ref}
      className={className}
      action={action}
      onSubmit={e => { e.preventDefault(); push(); }}
      onChange={e => { if ((e.target as HTMLElement).tagName === "SELECT") push(); }}
    >
      {children}
    </form>
  );
}
