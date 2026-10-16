import type { Language } from "../lib/api";
import { RATE_MAX, RATE_MIN, useVoices } from "../lib/prefs";

const PRESETS = [0.6, 0.8, 1, 1.2];

export function SpeedControl({ rate, onChange, compact }: { rate: number; onChange: (r: number) => void; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-slate-500">Tốc độ đọc</span>
      <input
        type="range"
        min={RATE_MIN}
        max={RATE_MAX}
        step={0.05}
        value={rate}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-indigo-600"
        aria-label="Tốc độ đọc"
      />
      <span className="w-10 tabular-nums font-medium text-slate-700">{rate.toFixed(2)}×</span>
      <div className={compact ? "hidden" : "hidden gap-1 sm:flex"}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`rounded px-1.5 py-0.5 text-xs ${Math.abs(rate - p) < 0.01 ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"}`}
          >
            {p}×
          </button>
        ))}
      </div>
    </div>
  );
}

export function VoiceSelect({ language, value, onChange }: { language: Language; value: string; onChange: (v: string) => void }) {
  const voices = useVoices(language);
  if (voices.length === 0) {
    return <span className="text-xs text-amber-700">Trình duyệt chưa có giọng {language}. Hãy cài thêm giọng trong cài đặt hệ thống.</span>;
  }
  return (
    <label className="flex items-center gap-2">
      <span className="text-slate-500">Giọng</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-56 rounded-md border border-slate-300 px-2 py-1">
        <option value="">Tự động (mỗi vai một giọng)</option>
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
    </label>
  );
}
