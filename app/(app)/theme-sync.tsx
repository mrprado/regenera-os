"use client";
// Keeps the theme cookie and <html data-theme> in step with the account preference (phase 26), e.g. on a new device
// where the cookie is not set yet. The root layout reads the cookie, so later pages paint in the right theme at once.
import { useEffect } from "react";
import { withBase } from "@/lib/base-path";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

export default function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
    if (!document.cookie.split("; ").includes(`${THEME_COOKIE}=${theme}`)) document.cookie = `${THEME_COOKIE}=${theme}; path=${withBase("/") || "/"}; max-age=31536000; samesite=lax; secure`;
  }, [theme]);
  return null;
}
