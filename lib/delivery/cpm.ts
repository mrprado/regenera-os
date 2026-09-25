// Critical path over project milestones (roadmap step 4). Remaining work starts no earlier than today; done milestones
// finish on their completion date. Forward pass gives the forecast, backward pass the slack; zero slack is critical.
// Pure function, no I/O.

export type CpmInput = {
  id: string; name: string; durationDays: number; dueDate: string | null; dependsOn: string[];
  status: string; completedAt: string | null;
};
export type CpmNode = {
  id: string; name: string; start: string; finish: string; slackDays: number; critical: boolean;
  lateDays: number;   // forecast finish after the committed due date
  overdue: boolean;   // due date passed and not done
  cycle: boolean;
};
export type CpmResult = { nodes: Map<string, CpmNode>; finish: string | null; criticalPath: string[]; cycles: string[] };

const DAY = 86_400_000;
const toDay = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY);
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

export function criticalPath(input: CpmInput[], today: string): CpmResult {
  const live = input.filter(m => m.status !== "cancelled");
  const byId = new Map(live.map(m => [m.id, m]));
  const deps = new Map(live.map(m => [m.id, m.dependsOn.filter(d => byId.has(d) && d !== m.id)]));
  const succ = new Map<string, string[]>(live.map(m => [m.id, []]));
  for (const [id, ds] of deps) for (const d of ds) succ.get(d)!.push(id);

  // Kahn topological order; whatever is left over sits on a dependency cycle.
  const indeg = new Map([...deps].map(([id, ds]) => [id, ds.length]));
  const queue = [...indeg].filter(([, n]) => n === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id)!) { indeg.set(s, indeg.get(s)! - 1); if (indeg.get(s) === 0) queue.push(s); }
  }
  const cycles = live.map(m => m.id).filter(id => !order.includes(id));

  const t0 = toDay(today);
  const es = new Map<string, number>(), ef = new Map<string, number>();
  for (const id of order) {
    const m = byId.get(id)!;
    if (m.status === "done") {
      const f = m.completedAt ? toDay(m.completedAt) : t0;
      es.set(id, f); ef.set(id, f);
      continue;
    }
    const start = Math.max(t0, ...deps.get(id)!.map(d => ef.get(d)!));
    es.set(id, start); ef.set(id, start + Math.max(0, m.durationDays));
  }
  const finishDay = order.length ? Math.max(...order.map(id => ef.get(id)!)) : null;

  const ls = new Map<string, number>(), lf = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const m = byId.get(id)!;
    const f = Math.min(finishDay!, ...succ.get(id)!.filter(s => ls.has(s)).map(s => ls.get(s)!));
    lf.set(id, f);
    ls.set(id, f - (m.status === "done" ? 0 : Math.max(0, m.durationDays)));
  }

  const nodes = new Map<string, CpmNode>();
  for (const m of live) {
    if (!es.has(m.id)) {
      nodes.set(m.id, { id: m.id, name: m.name, start: today, finish: today, slackDays: 0, critical: false, lateDays: 0, overdue: false, cycle: true });
      continue;
    }
    const done = m.status === "done";
    const slack = ls.get(m.id)! - es.get(m.id)!;
    const late = !done && m.dueDate ? ef.get(m.id)! - toDay(m.dueDate) : 0;
    nodes.set(m.id, {
      id: m.id, name: m.name, start: fromDay(es.get(m.id)!), finish: fromDay(ef.get(m.id)!), slackDays: slack,
      critical: !done && slack === 0, lateDays: Math.max(0, late), overdue: !done && !!m.dueDate && m.dueDate < today, cycle: false,
    });
  }
  const criticalPath = order.filter(id => nodes.get(id)!.critical);
  return { nodes, finish: finishDay === null ? null : fromDay(finishDay), criticalPath, cycles };
}
