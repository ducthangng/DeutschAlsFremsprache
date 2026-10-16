import { useEffect, useState } from "react";

/**
 * A silent, looping miniature of the practice screen: a short dialogue topic
 * with its script, played line by line (listen → speak → check → score),
 * first in English, then in German.
 */
interface Line {
  speaker: string;
  text: string;
  vi: string;
  wrong: number; // index of the mispronounced word, -1 for none
  score: number;
  bars: [number, number, number]; // accuracy, fluency, completeness
}

const TOPICS: { flag: string; title: string; speakers: string[]; lines: Line[] }[] = [
  {
    flag: "🇺🇸",
    title: "At the train station",
    speakers: ["Anna", "Agent"],
    lines: [
      { speaker: "Anna", text: "Excuse me, which platform is the train to Boston?", vi: "Xin lỗi, tàu đi Boston ở sân ga nào?", wrong: 3, score: 84, bars: [81, 90, 100] },
      { speaker: "Agent", text: "Platform four. It leaves in ten minutes.", vi: "Sân ga số bốn. Mười phút nữa tàu chạy.", wrong: 3, score: 88, bars: [86, 92, 100] },
      { speaker: "Anna", text: "Thank you so much!", vi: "Cảm ơn rất nhiều!", wrong: -1, score: 96, bars: [95, 97, 100] },
    ],
  },
  {
    flag: "🇩🇪",
    title: "Am Bahnhof",
    speakers: ["Anna", "Ben"],
    lines: [
      { speaker: "Anna", text: "Entschuldigung, wo ist Gleis drei?", vi: "Xin lỗi, sân ga số 3 ở đâu?", wrong: 3, score: 82, bars: [79, 88, 100] },
      { speaker: "Ben", text: "Gehen Sie geradeaus und dann links.", vi: "Đi thẳng rồi rẽ trái.", wrong: 2, score: 79, bars: [76, 85, 100] },
      { speaker: "Anna", text: "Vielen Dank für Ihre Hilfe!", vi: "Cảm ơn sự giúp đỡ của anh!", wrong: -1, score: 93, bars: [92, 95, 100] },
    ],
  },
];

type Step = "listen" | "speak" | "check" | "result";
const ORDER: Step[] = ["listen", "speak", "check", "result"];
const DURATION: Record<Step, number> = { listen: 2200, speak: 2000, check: 800, result: 2300 };
const SPEAKER_COLOR = ["text-indigo-700", "text-rose-700"];

function useReducedMotion() {
  const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  return reduced;
}

export default function LandingDemo({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion();
  const [topicIdx, setTopicIdx] = useState(0);
  const [lineIdx, setLineIdx] = useState(reduced ? 1 : 0);
  const [step, setStep] = useState<Step>(reduced ? "result" : "listen");
  const [t, setT] = useState(0); // ms into the current step

  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    const id = setInterval(() => {
      const el = performance.now() - started;
      if (el < DURATION[step]) return setT(el);
      const next = ORDER[(ORDER.indexOf(step) + 1) % ORDER.length];
      if (next === "listen") {
        // next line, or the next topic (language) after the last line
        if (lineIdx + 1 < TOPICS[topicIdx].lines.length) setLineIdx(lineIdx + 1);
        else {
          setLineIdx(0);
          setTopicIdx((topicIdx + 1) % TOPICS.length);
        }
      }
      setStep(next);
      setT(0);
    }, 50);
    return () => clearInterval(id);
  }, [step, lineIdx, topicIdx, reduced]);

  const topic = TOPICS[topicIdx];
  const line = topic.lines[lineIdx];
  const words = line.text.split(" ");
  const progress = step === "listen" ? t / DURATION.listen : 1;
  const passed = lineIdx + (step === "result" ? 1 : 0);
  const color = (sp: string) => SPEAKER_COLOR[Math.max(0, topic.speakers.indexOf(sp)) % 2];
  let offset = 0;

  return (
    <div className={`w-full overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-white/5 ${className}`} aria-hidden>
      {/* window bar: topic + modes */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {topic.flag} {topic.title}
          </p>
          <p className="whitespace-nowrap text-[11px] text-slate-400">
            Dialogue · <span className="text-emerald-600">{passed}/{topic.lines.length} passed</span>
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-[11px]">
          <span className="rounded-md bg-indigo-600 px-2 py-1 font-medium text-white">🗣 Shadowing</span>
          <span className="hidden px-2 py-1 text-slate-400 sm:inline">✍️ Listen → Write</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-[1.45fr_1fr]">
        {/* stage */}
        <div className="flex min-h-[14rem] flex-col p-5 sm:min-h-[19rem] sm:p-6">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="tabular-nums">
              {lineIdx + 1} / {topic.lines.length}
            </span>
            <span className={`font-semibold ${color(line.speaker)}`}>{line.speaker}</span>
          </div>

          <p className="mt-4 text-xl font-semibold leading-snug sm:text-2xl">
            {words.map((w, i) => {
              const start = offset;
              offset += w.length + 1;
              let cls = "text-slate-900";
              if (step === "listen") cls = start / line.text.length < progress ? "text-indigo-700" : "text-slate-300";
              if (step === "result") cls = i === line.wrong ? "font-extrabold text-red-500" : "text-emerald-600";
              return (
                <span key={`${topicIdx}-${lineIdx}-${i}`} className={`transition-colors duration-200 ${cls}`}>
                  {w}{" "}
                </span>
              );
            })}
          </p>
          <p className="mt-2 text-sm text-slate-400">{line.vi}</p>

          <div className="mt-auto pt-5">
            {step === "listen" && (
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">🔊</span>
                <span className="text-sm text-slate-500">Listen to the sentence…</span>
              </div>
            )}
            {step === "speak" && (
              <div className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 items-center justify-center">
                  <span className="animate-pulse-ring absolute inset-0 rounded-full bg-red-400" />
                  <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white">🎤</span>
                </span>
                <span className="flex h-7 items-center gap-[3px]">
                  {Array.from({ length: 12 }, (_, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-red-400/80"
                      style={{ height: `${20 + 70 * Math.abs(Math.sin(t / 140 + i * 0.9)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7)))}%` }}
                    />
                  ))}
                </span>
                <span className="text-sm text-slate-500">Your turn</span>
              </div>
            )}
            {step === "check" && (
              <div className="flex items-center gap-3">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                <span className="text-sm text-slate-500">Checking pronunciation…</span>
              </div>
            )}
            {step === "result" && (
              <div className="flex items-center gap-5">
                <div>
                  <p className="text-4xl font-bold leading-none text-slate-900">{line.score}</p>
                  <p className="mt-1.5 text-[11px] font-semibold text-emerald-600">✓ Passed</p>
                </div>
                <div className="grid flex-1 gap-1.5">
                  {(["Accuracy", "Fluency", "Completeness"] as const).map((label, i) => (
                    <div key={label} className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="w-20">{label}</span>
                      <span className="h-1 flex-1 rounded-full bg-slate-100">
                        <span className="block h-1 rounded-full bg-indigo-500" style={{ width: `${line.bars[i]}%` }} />
                      </span>
                      <span className="w-6 text-right tabular-nums text-slate-600">{line.bars[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* script */}
        <div className="hidden border-l border-slate-100 p-3 sm:block">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Script</p>
          <ol className="space-y-1">
            {topic.lines.map((l, i) => {
              const done = i < lineIdx || (i === lineIdx && step === "result");
              return (
                <li key={i} className={`flex gap-2 rounded-lg px-2 py-2 text-xs transition-colors ${i === lineIdx ? "bg-indigo-50" : ""}`}>
                  <span className={`mt-px w-3 shrink-0 ${done ? "text-emerald-500" : "text-slate-300"}`}>{done ? "✓" : "•"}</span>
                  <span className="min-w-0">
                    <span className={i > lineIdx ? "text-slate-400" : "text-slate-700"}>
                      <b className={`font-semibold ${color(l.speaker)}`}>{l.speaker}:</b> {l.text}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{l.vi}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
