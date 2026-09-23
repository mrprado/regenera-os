import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { getChatGPTUser, requireChatGPTUser, type ChatGPTUser } from "./chatgpt-auth";

// Phase 0 bootstrap: OS_ALLOWLIST (comma-separated emails). Phase 1 moves this to mandate_members.
function allowlist(): Set<string> {
  return new Set((env.OS_ALLOWLIST || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean));
}

export function isAllowed(email: string): boolean {
  return allowlist().has(email.toLowerCase());
}

/** Guard for every page and server action under app/(app). Signs in, then enforces the allowlist. */
export async function requireOsUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await requireChatGPTUser(returnTo);
  if (!isAllowed(user.email)) redirect("/not-allowed");
  return user;
}

export async function currentUser(): Promise<ChatGPTUser | null> {
  return getChatGPTUser();
}
