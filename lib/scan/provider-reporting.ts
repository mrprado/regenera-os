import type { ProviderStatus } from "@/db/scans";

/** Availability at launch is not evidence that the provider actually ran. */
export function completedProviders(providers: ProviderStatus[]): ProviderStatus[] {
  return providers.map(p => p.status === "ok" && !(p.calls ?? 0)
    ? { ...p, status: "skipped", detail: "No calls made: this provider was not reached before the scan finalized. Availability is not a successful discovery result." }
    : p);
}
