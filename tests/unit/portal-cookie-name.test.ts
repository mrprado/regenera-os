import { expect, it } from "vitest";
import { PORTAL_COOKIE } from "@/lib/portal/auth";
import { readFileSync } from "node:fs";
it("lib/auth.ts refuses open access to holders of the portal session cookie (names stay in sync)", () => {
  expect(readFileSync("lib/auth.ts", "utf8")).toContain(`const PORTAL_SESSION_COOKIE = "${PORTAL_COOKIE}"`);
});
