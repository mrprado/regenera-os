"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { getClient, issueCode, issuePersonalToken, revokeGrant, zAuthorize } from "@/lib/mcp/oauth";

/** Consent: the signed-in member approves the MCP client; a single-use code goes back to its redirect URI. */
export async function approveMcpAction(formData: FormData) {
  const params = zAuthorize.parse(Object.fromEntries(["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state"].map(k => [k, formData.get(k) ?? undefined])));
  const deny = formData.get("decision") === "deny";
  let target = "";
  await withOsUser(async user => {
    const client = await getClient(appDb(), params.client_id);
    if (!client || !client.redirectUris.includes(params.redirect_uri)) throw new Error("Unknown client or redirect URI");
    const url = new URL(params.redirect_uri);
    if (params.state) url.searchParams.set("state", params.state);
    if (deny) {
      url.searchParams.set("error", "access_denied");
    } else {
      url.searchParams.set("code", await issueCode(appDb(), { clientId: client.clientId, userEmail: user.email, redirectUri: params.redirect_uri, codeChallenge: params.code_challenge }));
      await audit(appDb(), { actor: user.email, action: "mcp_client_authorized", entity: "mcp_clients", entityId: client.clientId, after: { name: client.name } });
    }
    target = url.toString();
  });
  redirect(target);
}

export async function issueMcpTokenAction(formData: FormData) {
  const label = z.string().trim().max(80).parse(formData.get("label") ?? "") || "Claude Code";
  let token = "";
  await withOsUser(async user => {
    token = await issuePersonalToken(appDb(), user.email, label);
    await audit(appDb(), { actor: user.email, action: "mcp_personal_token", entity: "mcp_tokens", after: { label } });
  });
  redirect(`/settings/claude#token=${token}`);
}

export async function revokeMcpAction(formData: FormData) {
  const tokenId = z.string().uuid().optional().catch(undefined).parse(formData.get("tokenId") || undefined);
  const clientId = z.string().max(80).optional().catch(undefined).parse(formData.get("clientId") || undefined);
  await withOsUser(async user => {
    await revokeGrant(appDb(), user.email, { tokenId, clientId });
    await audit(appDb(), { actor: user.email, action: "mcp_revoke", entity: "mcp_tokens", after: { tokenId, clientId } });
  });
  redirect("/settings/claude");
}
