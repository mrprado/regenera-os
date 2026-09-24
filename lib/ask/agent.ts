// Ask the OS (docs/plans/phase-4.md item 1): plain questions answered with the shared tool registry.
import type Anthropic from "@anthropic-ai/sdk";
import { inArray } from "drizzle-orm";
import * as z from "zod/v4";
import { proposals } from "@/db/schema";
import { runAgent, type AgentEvent, type AgentTool, type AiConfig } from "@/lib/ai/run";
import { runTool, TOOLS, type ToolCtx } from "./tools";

export function agentTools(): AgentTool[] {
  return TOOLS.map(t => {
    const schema = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}

export type AskTurn = { role: "user" | "assistant"; text: string };

export async function askOs(ctx: ToolCtx, cfg: AiConfig, question: string, history: AskTurn[] = [], onEvent?: (e: AgentEvent) => void, client?: Anthropic) {
  const created: string[] = [];
  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.slice(-6).map(h => ({ role: h.role, content: h.text.slice(0, 4000) })),
    { role: "user", content: question.slice(0, 2000) },
  ];
  const today = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  const answer = await runAgent(ctx.db, cfg, "ask.os", { system: `Today is ${today}.`, messages }, agentTools(), async (name, input) => {
    const out = await runTool(ctx, name, input);
    const id = (out as { proposalId?: string } | null)?.proposalId;
    if (id) created.push(id);
    return out;
  }, { maxTurns: 6, onEvent, meta: { entity: "ask", entityId: ctx.actor } }, client);
  const pending = created.length ? await ctx.db.select({ id: proposals.id, title: proposals.title }).from(proposals).where(inArray(proposals.id, created)) : [];
  return { answer, proposals: pending };
}
