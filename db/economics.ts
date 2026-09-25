// Commercial and economics (docs/master-spec.md parts XXI–XXII; docs/plans/phase-6.md M8): revenue mechanisms with
// counterparty terms, and screening cases (base, downside, upside) whose outputs are computed by lib/economics/model.ts.
import { sql } from "drizzle-orm";
import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { CASE_KINDS, REVENUE_MECHANISMS, REVENUE_STATUSES, type CaseInputs, type CaseOutputs } from "../lib/economics/vocab";
import { projects } from "./projects";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const timestamps = { createdAt: text("created_at").notNull().default(now), updatedAt: text("updated_at").notNull().default(now) };

export const revenueStreams = sqliteTable("revenue_streams", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  mechanism: text("mechanism", { enum: keys(REVENUE_MECHANISMS) }).notNull(),
  name: text("name").notNull().default(""),
  counterpartyOrgId: text("counterparty_org_id"),
  counterparty: text("counterparty"),
  contractId: text("contract_id"),
  unitPrice: real("unit_price"),
  unit: text("unit"),                    // MWh, m3, t, month …
  annualVolume: real("annual_volume"),
  currency: text("currency").notNull().default("USD"),
  escalationPct: real("escalation_pct"), // % a year
  indexation: text("indexation").notNull().default(""),
  tenorYears: real("tenor_years"),
  counterpartyCredit: text("counterparty_credit").notNull().default(""),
  paymentSecurity: text("payment_security").notNull().default(""),
  termination: text("termination").notNull().default(""),
  status: text("status", { enum: keys(REVENUE_STATUSES) }).notNull().default("indicative"),
  ...timestamps,
}, t => [index("revenue_streams_project").on(t.projectId)]);

export const economicCases = sqliteTable("economic_cases", {
  id: id(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mandateId: text("mandate_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: keys(CASE_KINDS) }).notNull().default("base"),
  baseCaseId: text("base_case_id"),       // downside / upside derived from this case
  inputs: text("inputs", { mode: "json" }).$type<CaseInputs>().notNull(),
  outputs: text("outputs", { mode: "json" }).$type<CaseOutputs>(),
  source: text("source").notNull().default(""), // where the assumptions come from
  preparedBy: text("prepared_by"),
  ...timestamps,
}, t => [index("economic_cases_project").on(t.projectId)]);
