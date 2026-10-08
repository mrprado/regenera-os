// Human names for origination keys (phase 24): the UI never shows a raw service key or entrance code.
import { SERVICE_SEEDS } from "@/lib/commercial/catalog";

const NAMES = new Map(SERVICE_SEEDS.map(s => [s.key, s.name]));
/** Catalogue name for a service key; unknown keys become words. */
export const serviceName = (key: string | null | undefined) => (key ? NAMES.get(key) ?? key.replace(/_/g, " ") : "");

export const ENTRANCE_LABEL: Record<string, string> = { all: "All", capital_first: "From a funding call", project_first: "From a project", market_first: "From a market thesis" };
