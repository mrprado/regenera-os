import { requireOsUser } from "@/lib/auth";
import { mapConfig } from "@/lib/config";
import MapClient from "./map-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atlas" };

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOsUser("/map");
  const sp = await searchParams;
  return <>{sp.notice && <p role="status" style={{ position: "absolute", zIndex: 5, left: "50%", transform: "translateX(-50%)", top: 70, background: "var(--paper)", border: "1px solid var(--line)", padding: "6px 12px", borderRadius: 6, fontSize: 13 }}>{sp.notice}</p>}<MapClient esriKey={mapConfig().esriKey} /></>;
}
