import type { AssessResult } from "../lib/api";

export function scoreColor(score: number, threshold: number) {
  if (score >= Math.max(threshold, 85)) return "text-emerald-600";
  if (score >= threshold) return "text-lime-600";
  if (score >= threshold - 20) return "text-amber-500";
  return "text-red-500";
}

function Ring({ value, threshold }: { value: number; threshold: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} className="stroke-slate-100" strokeWidth="8" fill="none" />
        <circle
          cx="40"
          cy="40"
          r={r}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          className={`stroke-current ${scoreColor(value, threshold)} transition-all duration-700`}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${scoreColor(value, threshold)}`}>{Math.round(value)}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">điểm</span>
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span className="font-medium text-slate-700">{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
        <div className="h-1.5 rounded-full bg-indigo-500 transition-all duration-700" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function ScorePanel({ result }: { result: AssessResult }) {
  const s = result.scores;
  return (
    <div className="flex items-center gap-6">
      <Ring value={s.pronScore} threshold={result.threshold} />
      <div className="grid flex-1 gap-2">
        <Bar label="Chính xác" value={s.accuracyScore} />
        <Bar label="Trôi chảy" value={s.fluencyScore} />
        <Bar label="Đầy đủ" value={s.completenessScore} />
      </div>
    </div>
  );
}
