// Regenera's computational motif (docs/design-system.md): terrain field lines bent by a few "attractors" (landforms),
// with a sparse network of nodes over them (systems, flows). Deterministic (seeded), pure SVG, no assets.
// Used sparingly: sign-in, empty states, report covers.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function FieldMotif({ width = 1200, height = 900, seed = 7, lines = 46, nodes = 22, className }: { width?: number; height?: number; seed?: number; lines?: number; nodes?: number; className?: string }) {
  const r = rng(seed);
  const attractors = Array.from({ length: 4 }, () => ({ x: r() * width, y: r() * height, k: (r() - .5) * 140, s: 120 + r() * 220 }));
  const field = (x: number, y: number) => attractors.reduce((a, t) => a + t.k * Math.exp(-((x - t.x) ** 2 + (y - t.y) ** 2) / (2 * t.s * t.s)), 0);
  const paths: string[] = [];
  for (let i = 0; i < lines; i++) {
    const y0 = (i / (lines - 1)) * height * 1.1 - height * .05;
    let d = "";
    for (let x = -20; x <= width + 20; x += 16) {
      const y = y0 + field(x, y0) + Math.sin(x / 190 + i * .35) * 6;
      d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  const pts = Array.from({ length: nodes }, () => ({ x: width * (.08 + r() * .84), y: height * (.1 + r() * .8) }));
  const edges: [number, number][] = [];
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter(o => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const n of near) if (!edges.some(([a, b]) => (a === n.j && b === i))) edges.push([i, n.j]);
  });
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <radialGradient id="fm-glow" cx="62%" cy="42%" r="60%"><stop offset="0" stopColor="#d9a61c" stopOpacity=".22" /><stop offset="1" stopColor="#d9a61c" stopOpacity="0" /></radialGradient>
        <linearGradient id="fm-line" x1="0" x2="1"><stop offset="0" stopColor="#e3cf9f" stopOpacity=".05" /><stop offset=".55" stopColor="#e3cf9f" stopOpacity=".32" /><stop offset="1" stopColor="#d9a61c" stopOpacity=".10" /></linearGradient>
      </defs>
      <rect width={width} height={height} fill="url(#fm-glow)" />
      <g fill="none" stroke="url(#fm-line)" strokeWidth=".9">{paths.map((d, i) => <path key={i} d={d} />)}</g>
      <g stroke="#e3cf9f" strokeOpacity=".22" strokeWidth=".7">{edges.map(([a, b], i) => <line key={i} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} />)}</g>
      <g>{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i % 5 === 0 ? 3 : 1.8} fill={i === 3 ? "#d9a61c" : i % 5 === 0 ? "#d9a61c" : "#f2f0e9"} fillOpacity={i % 5 === 0 ? .95 : .6} />)}</g>
    </svg>
  );
}
