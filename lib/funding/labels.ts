// Display labels for the Funding screens.
export const ROUTE_LABEL: Record<string, string> = { regenera_bid: "Regenera bids", client_support: "Client applies, Regenera supports", consortium: "Consortium", signal: "Signal only" };
export const SOURCE_LABEL: Record<string, string> = { grants_gov: "Grants.gov", eu_funding: "EU Funding & Tenders", ted: "EU TED", worldbank: "World Bank", uk_contracts: "UK Contracts Finder" };

const money = (n: number | null, cur: string | null) => (n ? `${Math.round(n).toLocaleString("en-US")} ${cur ?? ""}`.trim() : null);
export const amount = (min: number | null, max: number | null, cur: string | null) =>
  min && max && min !== max ? `${money(min, cur)} to ${money(max, cur)}` : money(max ?? min, cur) ?? "Not stated";
export const daysLeft = (deadline: string | null, now = Date.now()) => (deadline ? Math.round((Date.parse(`${deadline}T12:00:00Z`) - now) / 86_400_000) : null);
export const daysLabel = (d: number) => (d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`);
