import type { Token } from "../lib/api";

/** Karaoke rendering: words light up as the reference audio progresses (0..1). */
export function KaraokeText({ text, progress, active }: { text: string; progress: number; active: boolean }) {
  const parts = text.split(/(\s+)/);
  const total = text.length || 1;
  let offset = 0;
  return (
    <span>
      {parts.map((p, i) => {
        const start = offset;
        offset += p.length;
        if (/^\s+$/.test(p)) return p;
        const sung = !active || start / total < progress;
        return (
          <span key={i} className={`transition-colors duration-150 ${sung ? "text-slate-900" : "text-slate-300"} ${active && sung ? "text-indigo-700" : ""}`}>
            {p}
          </span>
        );
      })}
    </span>
  );
}

const STATUS_TITLE: Record<Token["status"], string> = {
  ok: "Đúng",
  mispronounced: "Phát âm sai",
  omitted: "Bị bỏ sót",
  skip: "",
};

/** Assessment rendering: mispronounced/omitted words in bold red. */
export function AssessedText({ tokens }: { tokens: Token[] }) {
  return (
    <span>
      {tokens.map((t, i) => {
        const wrong = t.status === "mispronounced" || t.status === "omitted";
        return (
          <span key={i}>
            {i > 0 && " "}
            <span
              title={t.status === "skip" ? undefined : `${STATUS_TITLE[t.status]} · ${Math.round(t.score)}`}
              className={
                wrong
                  ? `font-bold text-red-600 ${t.status === "omitted" ? "underline decoration-dotted decoration-2 underline-offset-4" : ""}`
                  : "text-emerald-700"
              }
            >
              {t.text}
            </span>
          </span>
        );
      })}
    </span>
  );
}
