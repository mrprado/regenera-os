"use server";
// Appearance (phase 26): saves the theme to the person's account and mirrors it in a cookie for the first paint.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb } from "@/lib/db/scoped";
import { setTheme } from "@/lib/preferences";
import { THEME_COOKIE, THEMES, type Theme } from "@/lib/theme";

export async function setThemeAction(form: FormData) {
  const theme = z.enum(Object.keys(THEMES) as [Theme, ...Theme[]]).parse(form.get("theme"));
  const back = z.string().startsWith("/").catch("/appearance").parse(form.get("back"));
  await withOsUser(user => setTheme(appDb(), user.email, theme));
  (await cookies()).set(THEME_COOKIE, theme, { path: withBase("/") || "/", sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  redirect(back.includes("?") ? `${back}&notice=Appearance%20saved` : `${back}?notice=Appearance%20saved`);
}
