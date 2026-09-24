// Regenera OS MCP server (docs/plans/phase-4.md item 2). Stateless Streamable HTTP on the Worker, one server per
// request, the same tool registry and mandate scoping as Ask the OS. Writes are two-step: a propose_* tool returns
// a proposal, and confirm_proposal applies it. confirm_proposal is marked destructive so Claude asks the user
// before calling it, and every proposal can also be confirmed or discarded on the OS Home screen.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { proposals } from "@/db/schema";
import { confirmProposal, rejectProposal } from "@/lib/ask/execute";
import { runTool, TOOLS, type ToolCtx } from "@/lib/ask/tools";
import { verifyMcpToken } from "./oauth";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1).slice(0, 60_000) }] });

export function buildMcpServer(ctx: ToolCtx) {
  const server = new McpServer({ name: "regenera-os", version: "1.0.0" }, {
    instructions: "Regenera OS: Regenera's private CRM (people, companies, deals, triggers, replies, pipeline metrics), scoped to the signed-in member's mandates. " +
      "Read tools answer questions. propose_* tools never change data: they return a proposal. Only call confirm_proposal after the user has explicitly agreed to that exact proposal in this conversation.",
  });
  for (const t of TOOLS) {
    const shape = (t.input as z.ZodObject).shape;
    server.registerTool(t.name, {
      description: t.description,
      inputSchema: shape,
      annotations: { readOnlyHint: t.kind === "read", destructiveHint: false, idempotentHint: t.kind === "read", openWorldHint: false },
    }, async (args: Record<string, unknown>) => json(await runTool(ctx, t.name, args)));
  }
  server.registerTool("list_pending_proposals", {
    description: "Proposals waiting for confirmation in the member's mandates.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => json(await ctx.db.select({ id: proposals.id, title: proposals.title, source: proposals.source, createdAt: proposals.createdAt, expiresAt: proposals.expiresAt }).from(proposals)
    .where(and(inArray(proposals.mandateId, ctx.scope.mandateIds.length ? ctx.scope.mandateIds : ["__none__"]), eq(proposals.status, "pending"), eq(proposals.kind, "action"))).orderBy(desc(proposals.createdAt)).limit(20)));
  server.registerTool("confirm_proposal", {
    description: "Apply a proposal. Only call this after the user has clearly confirmed this exact proposal. Drafts go to the approval queue, never straight to sending.",
    inputSchema: { proposalId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ proposalId }: { proposalId: string }) => json(await confirmProposal(ctx.db, ctx.scope, `${ctx.actor} (via Claude)`, proposalId)));
  server.registerTool("reject_proposal", {
    description: "Discard a proposal the user does not want.",
    inputSchema: { proposalId: z.string(), reason: z.string().max(300).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ proposalId, reason }: { proposalId: string; reason?: string }) => json({ ok: await rejectProposal(ctx.db, ctx.scope, ctx.actor, proposalId, reason ?? "Discarded in Claude") }));
  return server;
}

export async function handleMcp(db: Db, request: Request, baseUrl: string): Promise<Response> {
  const scope = await verifyMcpToken(db, request.headers.get("authorization"));
  if (!scope) {
    return new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${baseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource"` },
    });
  }
  const server = buildMcpServer({ db, scope, actor: scope.email, source: "mcp" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
