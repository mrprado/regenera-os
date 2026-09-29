// Structural skeleton shown the moment a route starts loading: the shell (header, sidebar) stays interactive and the
// page frame appears immediately instead of a blank screen or a full-page spinner.
import s from "@/components/skeleton.module.css";

export default function Loading() {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} className={`${s.line} ${s.shim} ${i % 3 === 2 ? s.short : ""}`} />);
  return (
    <div className={s.wrap} aria-busy="true" aria-label="Loading">
      <div className={`${s.title} ${s.shim}`} />
      <div className={s.row}>{Array.from({ length: 4 }, (_, i) => <div key={i} className={`${s.stat} ${s.shim}`} />)}</div>
      <div className={s.grid}><div className={s.panel}>{lines(9)}</div><div className={s.panel}>{lines(5)}</div></div>
    </div>
  );
}
