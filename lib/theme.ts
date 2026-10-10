// Appearance preference (phase 26). Stored per person on tenant_members.theme and mirrored in a cookie so the root
// layout can set <html data-theme> before the first paint (no light flash).
export const THEMES = { light: "Light", dark: "Dark", system: "Match my device" } as const;
export type Theme = keyof typeof THEMES;
export const THEME_COOKIE = "regenera_theme";
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && v in THEMES;
export const themeOrDefault = (v: unknown): Theme => (isTheme(v) ? v : "light");

/** WCAG relative luminance contrast ratio between two #rrggbb colours (for the token checks in tests). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
