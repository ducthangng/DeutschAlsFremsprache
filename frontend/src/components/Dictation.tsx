import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type DictationResult, type Item, type TopicDetail } from "../lib/api";
import Spinner from "./Spinner";

const NEAR = new Set(["case", "spelling", "typo"]);
const NEAR_LABEL: Record<string, string> = { case: "viết hoa/thường", spelling: "umlaut / ß", typo: "lỗi chính tả nhỏ" };

/** Underscores hinting the number and rough length of the words. */
function blanks(text: string) {
  return text
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => "_".repeat(Math.min(10, Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length))))
    .join("  ");
}

export interface DictationProps {
  topic: TopicDetail;
  /** Plays one line at the given speed; resolves when done. */
  play: (item: Item, rate: number) => Promise<void>;
  stop: () => void;
  rate: number;
  /** "generating" / "loading" while the reference audio is being prepared. */
  speechStatus: string;
  meaningOf: (item: Item) => string;
  onGraded: (itemId: number, best: { score: number; passed: boolean }) => void;
}

/** "Listen -> Write": hear a line, type it, get each word graded. */
export default function Dictation({ topic, play, stop, rate, speechStatus, meaningOf, onGraded }: DictationProps) {
  const items = topic.items;
  const firstOpen = Math.max(0, items.findIndex((it) => !it.dictation?.passed));
  const [index, setIndex] = useState(firstOpen);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<DictationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const item = items[index];
  const passed = items.filter((it) => it.dictation?.passed).length;

  async function listen(slow = false) {
    setPlaying(true);
    try {
      await play(item, slow ? Math.max(0.5, rate * 0.7) : rate);
    } finally {
      setPlaying(false);
      input.current?.focus();
    }
  }

  // New line: clear, then play it once automatically.
  useEffect(() => {
    setAnswer("");
    setResult(null);
    setHint(false);
    setError("");
    const t = setTimeout(() => listen(), 300);
    return () => {
      clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function check() {
    if (busy || !answer.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.gradeDictation(item.id, answer);
      setResult(res);
      const prev = item.dictation;
      onGraded(item.id, { score: Math.max(prev?.score ?? 0, res.score), passed: !!prev?.passed || res.passed });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chấm được");
    } finally {
      setBusy(false);
    }
  }

  function go(i: number) {
    if (i >= 0 && i < items.length) setIndex(i);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (result) go(index + 1);
      else check();
    } else if (e.key === "Escape") {
      e.preventDefault();
      listen();
    }
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-5">
      <section className="lg:col-span-3">
        <div className="rounded-3xl bg-surface p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span className="tabular-nums">
              {index + 1} / {items.length}
            </span>
            <span>
              {passed}/{items.length} câu đạt
            </span>
          </div>

          {item.imageUrl && <img src={item.imageUrl} alt="" className="mt-6 max-h-56 w-full rounded-2xl object-cover" />}

          {/* Listen */}
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={() => listen()}
              disabled={playing}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-2xl text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-500 disabled:opacity-60"
              title="Nghe lại (Esc)"
            >
              {playing && speechStatus ? <Spinner className="h-6 w-6 border-white/30 border-t-white" /> : "🔊"}
            </button>
            <button onClick={() => listen(true)} disabled={playing} className="rounded-xl px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50" title="Nghe chậm">
              🐢 Chậm
            </button>
            <span className="text-sm text-slate-400">
              {playing ? (speechStatus === "generating" ? "Generating…" : speechStatus === "loading" ? "Loading…" : "Đang phát…") : "Nghe rồi gõ lại câu bạn nghe được"}
            </span>
          </div>

          {/* Write */}
          {!result ? (
            <>
              <textarea
                ref={input}
                autoFocus
                rows={2}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={onKey}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                lang={topic.language}
                placeholder="Gõ câu bạn nghe được…"
                className="mt-6 w-full resize-none rounded-2xl border border-slate-200 bg-transparent px-5 py-4 text-2xl leading-snug outline-none placeholder:text-slate-300 focus:border-indigo-300"
              />
              {hint && <p className="mt-3 font-mono text-lg tracking-wider text-slate-400">{blanks(item.text)}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button onClick={check} disabled={busy || !answer.trim()} className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
                  {busy ? "Đang chấm…" : "Kiểm tra"}
                </button>
                <button onClick={() => setHint((h) => !h)} className="rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-100">
                  💡 {hint ? "Ẩn gợi ý" : "Gợi ý"}
                </button>
                <span className="ml-auto text-xs text-slate-400">Enter: kiểm tra · Esc: nghe lại</span>
              </div>
            </>
          ) : (
            <div className="mt-6" onKeyDown={onKey}>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${result.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {result.passed ? "✓ Đạt" : `Chưa đạt · cần ${result.passScore}`}
                </span>
                <span className="text-2xl font-bold tabular-nums text-slate-800">{Math.round(result.score)}</span>
              </div>

              {/* The learner's words, graded */}
              <p className="mt-5 flex flex-wrap gap-x-2 gap-y-3 text-2xl leading-snug">
                {result.tokens.map((t, i) => {
                  if (t.status === "ok") return <span key={i} className="text-emerald-600">{t.text}</span>;
                  if (NEAR.has(t.status))
                    return (
                      <span key={i} className="inline-flex flex-col items-start" title={NEAR_LABEL[t.status]}>
                        <span className="text-amber-500 underline decoration-dotted underline-offset-4">{t.text}</span>
                        <span className="text-xs text-slate-400">{t.expected}</span>
                      </span>
                    );
                  if (t.status === "missing")
                    return (
                      <span key={i} className="rounded border border-dashed border-red-200 px-1 text-red-500" title="Thiếu từ">
                        {t.expected}
                      </span>
                    );
                  if (t.status === "extra")
                    return (
                      <span key={i} className="text-red-500 line-through decoration-2" title="Thừa từ">
                        {t.text}
                      </span>
                    );
                  return (
                    <span key={i} className="inline-flex flex-col items-start" title="Sai từ">
                      <span className="font-semibold text-red-600 line-through decoration-2">{t.text}</span>
                      <span className="text-xs text-emerald-600">{t.expected}</span>
                    </span>
                  );
                })}
              </p>

              <div className="mt-6 rounded-2xl bg-slate-100 px-5 py-4">
                <p data-lookup data-sentence={item.text} className="text-xl text-slate-800 selection:bg-amber-200">
                  {item.speaker && <span className="text-slate-400">{item.speaker}: </span>}
                  {item.text}
                </p>
                {meaningOf(item) && <p className="mt-1 text-slate-400">{meaningOf(item)}</p>}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {index + 1 < items.length ? (
                  <button autoFocus onClick={() => go(index + 1)} className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500">
                    Câu tiếp →
                  </button>
                ) : (
                  <span className="text-sm text-slate-500">🎉 Hết bài. {passed === items.length ? "Bạn đã đạt mọi câu!" : "Chọn câu chưa đạt bên phải để làm lại."}</span>
                )}
                <button
                  onClick={() => {
                    setResult(null);
                    setAnswer("");
                    setTimeout(() => input.current?.focus());
                  }}
                  className="rounded-xl px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                >
                  ↺ Viết lại
                </button>
                <span className="ml-auto text-xs text-slate-400">Enter: câu tiếp</span>
              </div>
            </div>
          )}
          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="mt-3 flex justify-between">
          <button disabled={index === 0} onClick={() => go(index - 1)} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-700 disabled:opacity-30">
            ← Câu trước
          </button>
          <button disabled={index + 1 >= items.length} onClick={() => go(index + 1)} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-700 disabled:opacity-30">
            Bỏ qua →
          </button>
        </div>
      </section>

      {/* Lines stay hidden until attempted, so the list does not give answers away */}
      <aside className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-2xl bg-surface p-3 ring-1 ring-slate-200">
          <h2 className="px-2 pb-2 pt-1 text-sm font-semibold text-slate-400">Các câu</h2>
          <ol className="max-h-[70vh] space-y-0.5 overflow-y-auto">
            {items.map((it, i) => (
              <li key={it.id}>
                <button
                  onClick={() => go(i)}
                  className={`flex w-full gap-3 rounded-lg px-2 py-2 text-left text-sm ${i === index ? "bg-indigo-50" : "hover:bg-slate-100"}`}
                >
                  <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{it.dictation ? it.text : <span className="tracking-widest text-slate-300">• • • • •</span>}</span>
                  <span className={`shrink-0 text-xs tabular-nums ${it.dictation?.passed ? "text-emerald-600" : "text-slate-400"}`}>
                    {it.dictation ? (it.dictation.passed ? "✓" : Math.round(it.dictation.score)) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
