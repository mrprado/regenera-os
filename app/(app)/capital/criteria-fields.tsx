import { INSTRUMENTS, PROJECT_STAGES } from "@/lib/projects/vocab";
import { SECTORS } from "@/lib/vocab";
import styles from "../projects/projects.module.css";

type C = { geographies?: string[]; sectors?: string[]; stages?: string[]; instruments?: string[]; ticketMin?: number | null; ticketMax?: number | null; currency?: string | null };

/** Investment criteria used for matching. Leave anything unknown empty: it neither helps nor hurts a match. */
export default function CriteriaFields({ c = {} }: { c?: C }) {
  return (
    <div className={styles.grid2}>
      <label className={styles.wide}>Geographies (comma-separated: countries, regions such as LATAM, or global)<input name="geographies" defaultValue={(c.geographies ?? []).join(", ")} /></label>
      <label>Sectors<select name="sectors" multiple defaultValue={c.sectors ?? []} size={5}>{Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Project stages<select name="stages" multiple defaultValue={c.stages ?? []} size={5}>{Object.entries(PROJECT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className={styles.wide}>Instruments<select name="instruments" multiple defaultValue={c.instruments ?? []} size={6}>{Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Ticket minimum<input name="ticketMin" inputMode="decimal" defaultValue={c.ticketMin ?? ""} /></label>
      <label>Ticket maximum<input name="ticketMax" inputMode="decimal" defaultValue={c.ticketMax ?? ""} /></label>
      <label>Currency<input name="currency" defaultValue={c.currency ?? ""} placeholder="USD" /></label>
    </div>
  );
}
