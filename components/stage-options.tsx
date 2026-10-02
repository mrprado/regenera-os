// Project stage <option>s grouped by phase (phase 15 §12): five readable groups instead of eighteen flat entries.
import { PROJECT_STAGES, STAGE_PHASES } from "@/lib/projects/vocab";

export function StageOptions() {
  return <>{STAGE_PHASES.map(ph => <optgroup key={ph.label} label={ph.label}>{ph.stages.map(k => <option key={k} value={k}>{PROJECT_STAGES[k]}</option>)}</optgroup>)}</>;
}
