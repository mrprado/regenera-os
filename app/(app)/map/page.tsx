import { requireOsUser } from "@/lib/auth";
import { mapConfig } from "@/lib/config";
import MapClient from "./map-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map" };

export default async function MapPage() {
  await requireOsUser("/map");
  return <MapClient esriKey={mapConfig().esriKey} />;
}
