import Link from "next/link";
import ui from "./ui.module.css";

export function Notice({ text }: { text?: string }) {
  return text ? <p className={ui.notice} role="status">{text}</p> : null;
}

const EMAIL_LABEL: Record<string, [string, string]> = {
  verified_provider: ["Verified", ui.chipReed],
  verified_manual: ["Verified (manual)", ui.chipReed],
  unverified: ["Unverified", ui.chipPollen],
  inferred: ["Inferred", ui.chipPollen],
  invalid: ["Invalid", ui.chipEmber],
  unknown: ["No email", ui.chipMuted],
};
export function EmailChip({ status }: { status: string }) {
  const [label, cls] = EMAIL_LABEL[status] ?? [status, ""];
  return <span className={`${ui.chip} ${cls}`}>{label}</span>;
}

const TIER_CLS: Record<string, string> = { targeted: ui.chipPollen, mass: ui.chipWater, watchlist: ui.chipMuted, parked: ui.chipMuted };
export function ScoreChip({ score, tier }: { score: number | null; tier: string | null }) {
  if (score == null) return <span className={`${ui.chip} ${ui.chipMuted}`}>Not scored</span>;
  return <span className={`${ui.chip} ${TIER_CLS[tier ?? ""] ?? ""}`}><b>{score}</b>{tier ? ` · ${tier}` : ""}</span>;
}

export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", marginTop: 12, fontSize: 13 }} aria-label="Pages">
      {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
      <span style={{ color: "var(--text-muted)" }}>Page {page} of {pages}</span>
      {page < pages && <Link href={href(page + 1)}>Next</Link>}
    </nav>
  );
}

/** Builds a URL for the current screen with some params replaced. */
export function withParams(base: string, sp: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
