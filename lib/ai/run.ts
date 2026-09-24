// AI contracts (SPEC section 22): versioned prompts, zod-validated structured outputs, cost logging,
// a monthly budget guard, and explicit stop_reason handling. Server-side only.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type * as z4 from "zod/v4";
import type { Db } from "@/db";
import { aiRuns, prompts } from "@/db/schema";
import { PROMPTS, type PromptDef, type PromptKey } from "./prompts";

// Anthropic first-party prices per million tokens (claude-api skill, cached 2026-06-24).
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
// Web search is billed per search; confirm on the pricing page when it changes.
const WEB_SEARCH_USD = 0.01;

export type AiConfig = { apiKey: string; monthlyBudgetUsd: number };

export class AiBudgetError extends Error {}
export class AiOutputError extends Error {}

export function costUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number }): number {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.input * 0.1 + u.cacheWrite * p.input * 1.25) / 1_000_000
    + u.searches * WEB_SEARCH_USD;
}

export async function spentThisMonth(db: Db, now = new Date()): Promise<number> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [{ total }] = await db.select({ total: sql<number>`coalesce(sum(${aiRuns.costUsd}), 0)` }).from(aiRuns).where(gte(aiRuns.createdAt, since));
  return total;
}

/** Seeds version 1 of every prompt; later edits in Settings create new versions and never edit old ones. */
export async function ensurePrompts(db: Db): Promise<void> {
  for (const [key, def] of Object.entries(PROMPTS)) {
    await db.insert(prompts).values({ key, version: 1, model: def.model, system: def.system }).onConflictDoNothing();
  }
}

async function activePrompt(db: Db, key: PromptKey) {
  const [row] = await db.select().from(prompts).where(and(eq(prompts.key, key), eq(prompts.active, true))).orderBy(desc(prompts.version)).limit(1);
  if (row) return row;
  await ensurePrompts(db);
  const [seeded] = await db.select().from(prompts).where(and(eq(prompts.key, key), eq(prompts.active, true))).orderBy(desc(prompts.version)).limit(1);
  return seeded;
}

type Usage = Anthropic.Messages.Usage;
const usageOf = (u: Usage) => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  searches: u.server_tool_use?.web_search_requests ?? 0,
});

type RunMeta = { entity?: string; entityId?: string };

async function guardBudget(db: Db, cfg: AiConfig, key: string, version: number, model: string, meta: RunMeta) {
  const spent = await spentThisMonth(db);
  if (spent >= cfg.monthlyBudgetUsd) {
    await db.insert(aiRuns).values({ promptKey: key, promptVersion: version, model, ...meta, status: "budget", error: `Monthly AI budget reached ($${spent.toFixed(2)} of $${cfg.monthlyBudgetUsd})` });
    throw new AiBudgetError(`Monthly AI budget reached ($${spent.toFixed(2)} of $${cfg.monthlyBudgetUsd}).`);
  }
}

async function log(db: Db, row: typeof aiRuns.$inferInsert) {
  await db.insert(aiRuns).values(row);
}

/**
 * Structured call: the model must return JSON matching `schema` (zod v4, as the SDK helper expects).
 * An invalid output retries once with the validation error attached.
 */
export async function runStructured<T>(db: Db, cfg: AiConfig, key: PromptKey, input: string, schema: z4.ZodType<T>, meta: RunMeta = {}, client?: Anthropic): Promise<T> {
  const prompt = await activePrompt(db, key);
  await guardBudget(db, cfg, key, prompt.version, prompt.model, meta);
  const anthropic = client ?? new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2 });
  const def: PromptDef = PROMPTS[key];
  let userContent = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const res = await anthropic.messages.parse({
      model: prompt.model,
      max_tokens: def.maxTokens,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(schema), ...(def.effort ? { effort: def.effort } : {}) },
      ...(def.thinking ? { thinking: { type: "adaptive" as const } } : {}),
    });
    const u = usageOf(res.usage);
    const base = {
      promptKey: key, promptVersion: prompt.version, model: prompt.model, ...meta,
      inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
      webSearches: u.searches, costUsd: costUsd(prompt.model, u), latencyMs: Date.now() - started,
    };
    if (res.stop_reason === "refusal") {
      await log(db, { ...base, status: "refusal", error: res.stop_details?.explanation ?? "refused" });
      throw new AiOutputError(`The model declined this ${key} request.`);
    }
    if (res.stop_reason === "max_tokens") {
      await log(db, { ...base, status: "invalid", error: "max_tokens reached" });
      throw new AiOutputError(`${key} output was cut off at max_tokens.`);
    }
    if (res.parsed_output != null) {
      await log(db, { ...base, status: "ok" });
      return res.parsed_output as T;
    }
    await log(db, { ...base, status: "invalid", error: "output did not match schema" });
    userContent = `${input}\n\nYour previous answer did not match the required JSON schema. Return only valid JSON for the schema.`;
  }
  throw new AiOutputError(`${key} returned invalid output twice.`);
}

/**
 * Research call with Anthropic web search + web fetch (server tools). Returns the model's text notes.
 * Handles pause_turn by resuming up to 3 times.
 */
export async function runWebResearch(db: Db, cfg: AiConfig, key: PromptKey, input: string, opts: { maxSearches: number; maxFetches: number }, meta: RunMeta = {}, client?: Anthropic): Promise<string> {
  const prompt = await activePrompt(db, key);
  await guardBudget(db, cfg, key, prompt.version, prompt.model, meta);
  const anthropic = client ?? new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2 });
  const def: PromptDef = PROMPTS[key];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input }];
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  const started = Date.now();
  let text = "";
  for (let turn = 0; turn < 4; turn++) {
    const stream = anthropic.messages.stream({
      model: prompt.model,
      max_tokens: def.maxTokens,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxFetches },
      ],
      thinking: { type: "adaptive" },
      ...(def.effort ? { output_config: { effort: def.effort } } : {}),
    });
    const res = await stream.finalMessage();
    const u = usageOf(res.usage);
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += u[k];
    text += res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n");
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const base = {
      promptKey: key, promptVersion: prompt.version, model: prompt.model, ...meta,
      inputTokens: totals.input, outputTokens: totals.output, cacheReadTokens: totals.cacheRead, cacheWriteTokens: totals.cacheWrite,
      webSearches: totals.searches, costUsd: costUsd(prompt.model, totals), latencyMs: Date.now() - started,
    };
    if (res.stop_reason === "refusal") {
      await log(db, { ...base, status: "refusal", error: res.stop_details?.explanation ?? "refused" });
      throw new AiOutputError(`The model declined this ${key} request.`);
    }
    await log(db, { ...base, status: "ok" });
    return text.trim();
  }
  await log(db, {
    promptKey: key, promptVersion: prompt.version, model: prompt.model, ...meta,
    inputTokens: totals.input, outputTokens: totals.output, webSearches: totals.searches,
    costUsd: costUsd(prompt.model, totals), latencyMs: Date.now() - started, status: "error", error: "still paused after 3 resumptions",
  });
  throw new AiOutputError(`${key} research did not finish.`);
}
