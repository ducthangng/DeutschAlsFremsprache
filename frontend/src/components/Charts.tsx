import { useState, type ReactNode } from "react";

/*
 * Small, quiet charts for the flashcard statistics.
 * Colors are raw hex on purpose (validated for the dark surface; the theme
 * remaps named shades): one blue for single-series bars, and a 4-step
 * ordinal blue ramp for mastery (darkest = new, brightest = mature).
 */
export const CHART_BLUE = "#3987e5";
export const MASTERY_RAMP = ["#184f95", "#2a78d6", "#6da7ec", "#b7d3f6"];

/** A headline number with a label and an optional hint line. */
export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-slate-200">
      <p className="text-sm text-slate-500">
        {icon && <span className="mr-1">{icon}</span>}
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export interface Bar {
  key: string;
  label: string; // axis label (shown sparsely)
  value: number;
  tooltip: ReactNode;
}

/**
 * Single-series column chart: thin columns, rounded data end, square at the
 * baseline, 2px gaps, hover tooltip. `labelEvery` thins out the axis labels.
 */
export function ColumnChart({ bars, height = 120, labelEvery = 1, ariaLabel }: { bars: Bar[]; height?: number; labelEvery?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="relative" role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-[2px] border-b border-slate-200" style={{ height }}>
        {bars.map((b, i) => (
          <div
            key={b.key}
            className="relative flex h-full flex-1 cursor-default items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="w-full max-w-6 rounded-t-[4px] transition-opacity"
              style={{
                height: b.value ? `${Math.max(3, (b.value / max) * (height - 4))}px` : 0,
                background: CHART_BLUE,
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg bg-[#262a33] px-2.5 py-1.5 text-xs text-slate-800 shadow-xl ring-1 ring-white/10">
                {b.tooltip}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[10px] text-slate-400">
        {bars.map((b, i) => (
          <span key={b.key} className="flex flex-1 justify-center whitespace-nowrap">
            {i === bars.length - 1 || (i % labelEvery === 0 && bars.length - 1 - i >= labelEvery / 2) ? b.label : ""}
          </span>
        ))}
      </div>
      <span className="absolute -top-4 left-0 text-[10px] tabular-nums text-slate-400">{max}</span>
    </div>
  );
}

/** Stacked bar of cards by learning stage, with a legend (several series). */
export function MasteryBar({ parts }: { parts: { label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px] bg-slate-100" role="img" aria-label="Phân bố mức độ ghi nhớ">
        {total > 0 &&
          parts.map((p, i) =>
            p.value ? (
              <div
                key={p.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="h-full transition-opacity"
                style={{ width: `${(p.value / total) * 100}%`, background: MASTERY_RAMP[i], opacity: hover === null || hover === i ? 1 : 0.5 }}
                title={`${p.label}: ${p.value}`}
              />
            ) : null,
          )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {parts.map((p, i) => (
          <span key={p.label} className="flex items-center gap-1.5 text-slate-600" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: MASTERY_RAMP[i] }} />
            {p.label} <span className="tabular-nums text-slate-400">{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ring meter for today's goal. */
export function GoalRing({ value, goal, size = 96 }: { value: number; goal: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, goal ? value / goal : 0);
  return (
    <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Hôm nay ${value}/${goal} thẻ`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#1f3a63" strokeWidth="8" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={pct >= 1 ? "#22c08a" : CHART_BLUE}
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className="transition-all duration-700"
      />
    </svg>
  );
}

/**
 * Line graph of how learners' average scores are distributed, with the
 * current user marked. Single series: the title names it, no legend.
 */
export function ScoreDistribution({ buckets, mine }: { buckets: { from: number; users: number }[]; mine: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 480, H = 160, top = 28, bottom = 22;
  const max = Math.max(1, ...buckets.map((b) => b.users));
  const pts = buckets.map((b) => ({ x: ((b.from + 2.5) / 100) * W, y: H - bottom - (b.users / max) * (H - top - bottom) }));
  // smooth curve through the bucket midpoints
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  const base = H - bottom;
  const area = `${d} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z`;
  const yAt = (score: number) => {
    const fx = Math.min(Math.max(score / 5 - 0.5, 0), pts.length - 1);
    const i = Math.floor(fx), t = fx - i, a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    return a.y + (b.y - a.y) * t;
  };
  const mx = mine === null ? 0 : (mine / 100) * W;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Phân bố điểm trung bình của người học">
        <line x1={0} x2={W} y1={base} y2={base} stroke="#2a2e37" strokeWidth={1} />
        {[0, 25, 50, 75, 100].map((t) => (
          <text key={t} x={(t / 100) * W} y={H - 6} fontSize={10} fill="#737b8a" textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}>
            {t}
          </text>
        ))}
        <path d={area} fill={CHART_BLUE} opacity={0.1} />
        <path d={d} fill="none" stroke={CHART_BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={pts[hover].x} x2={pts[hover].x} y1={top - 8} y2={base} stroke="#4b5160" strokeWidth={1} />}
        {mine !== null && (
          <g>
            <line x1={mx} x2={mx} y1={yAt(mine)} y2={base} stroke="#ffda1a" strokeWidth={1.5} />
            <circle cx={mx} cy={yAt(mine)} r={6} fill="#ffda1a" stroke="#17191f" strokeWidth={2} />
            <text x={Math.min(Math.max(mx, 30), W - 30)} y={Math.max(yAt(mine) - 12, 11)} fontSize={11} fontWeight={700} fill="#eef0f4" textAnchor="middle" stroke="#17191f" strokeWidth={4} paintOrder="stroke">
              Bạn · {Math.round(mine)}
            </text>
          </g>
        )}
        {/* hover targets wider than the line */}
        {buckets.map((b, i) => (
          <rect key={b.from} x={(b.from / 100) * W} y={0} width={W / 20} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#262a33] px-2.5 py-1.5 text-xs text-slate-800 shadow-xl ring-1 ring-white/10"
          style={{ left: `${(pts[hover].x / W) * 100}%` }}
        >
          <b className="font-semibold">
            {buckets[hover].from}–{buckets[hover].from + 4} điểm
          </b>{" "}
          · {buckets[hover].users} người
        </div>
      )}
    </div>
  );
}
