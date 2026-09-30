import { DIM_STATUS, FIT_BASIS, fitEvidence } from "@/lib/capital/fit-evidence";
import s from "./fit-evidence.module.css";

/** Per-dimension capital fit with an evidence basis; never a percentage (lib/capital/fit-evidence.ts). */
export function FitEvidence({ reasons, compact = false }: { reasons: string[]; compact?: boolean }) {
  const f = fitEvidence(reasons);
  return (
    <div className={s.fit}>
      <span className={s.basis} data-basis={f.basis}>{FIT_BASIS[f.basis]}</span>
      <ul className={s.dims}>
        {f.dims.map(d => <li key={d.dimension} data-status={d.status} title={d.text}><i aria-hidden />{d.dimension}<span className="sr-only">: {DIM_STATUS[d.status]}</span></li>)}
      </ul>
      {!compact && <span className={s.why}>{f.rationale}</span>}
    </div>
  );
}
