import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { getTheme } from "@/lib/preferences";
import { THEMES } from "@/lib/theme";
import { setThemeAction } from "./actions";
import s from "./appearance.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appearance" };

const HELP: Record<keyof typeof THEMES, string> = {
  light: "Ivory canvas and white panels (the standard look).",
  dark: "Carbon Moss canvas and Graphite Moss panels. Easier on the eyes in long or late sessions.",
  system: "Follows your computer or phone setting, switching with it automatically.",
};

/** Settings → Appearance (phase 26): light, dark or match the device; saved to the person's account. */
export default async function AppearancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/appearance");
  const sp = await searchParams;
  const theme = user.visitor ? "light" : await getTheme(appDb(), user.email).catch(() => "light" as const);
  return (
    <>
      <PageHeader title="Appearance" />
      <Notice text={sp.notice} />
      <form action={setThemeAction} className={s.form}>
        <input type="hidden" name="back" value="/appearance" />
        <fieldset className={s.choices}>
          <legend>Theme</legend>
          {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map(k => (
            <label key={k} className={s.choice} data-theme-preview={k}>
              <input type="radio" name="theme" value={k} defaultChecked={theme === k} disabled={!!user.visitor} />
              <span className={s.swatch} aria-hidden />
              <span><b>{THEMES[k]}</b><span className={ui.sub}>{HELP[k]}</span></span>
            </label>
          ))}
        </fieldset>
        <p className={ui.sub}>Saved to your account, so it follows you to other devices. Atlas keeps its own map styles; its panels follow the theme.</p>
        {user.visitor ? <p className={ui.sub}>Sign in to choose a theme.</p> : <button className="btn btn--primary" type="submit">Save appearance</button>}
      </form>
    </>
  );
}
