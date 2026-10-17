import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, type Language } from "../lib/api";
import { micErrorMessage, Recorder, speak, startRecorder, type Playback } from "../lib/audio";
import Spinner from "./Spinner";

/** The words of a graded sentence that were mispronounced or skipped, without punctuation. */
export function wrongWords(tokens: { text: string; status: string }[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.status !== "mispronounced" && t.status !== "omitted") continue;
    const w = t.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

type Phase = "idle" | "recording" | "checking";
interface WordResult {
  score: number;
  ok: boolean;
}

/**
 * Shown when a sentence passed but some words were still off: re-practice
 * just those words one by one (listen → say → graded), or move on.
 */
export default function WordDrill({
  itemId,
  words,
  language,
  rate,
  voiceURI,
  stream,
  hasNext,
  onNext,
}: {
  itemId: number;
  words: string[];
  language: Language;
  rate: number;
  voiceURI?: string;
  stream: MutableRefObject<MediaStream | null>;
  hasNext: boolean;
  onNext: () => void;
}) {
  const [stage, setStage] = useState<"offer" | "drill" | "done">("offer");
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [results, setResults] = useState<Record<string, WordResult>>({});
  const [error, setError] = useState("");
  const recorder = useRef<Recorder | null>(null);
  const playback = useRef<Playback | null>(null);
  const word = words[i];

  useEffect(
    () => () => {
      recorder.current?.cancel();
      playback.current?.stop();
    },
    [],
  );

  // Say each new word once when it comes up.
  useEffect(() => {
    if (stage === "drill" && word) listen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, i]);

  function listen(slow: boolean) {
    playback.current?.stop();
    playback.current = speak(word, { lang: language, rate: slow ? Math.max(0.5, rate * 0.65) : rate, voiceURI });
  }

  async function record() {
    playback.current?.stop();
    setError("");
    try {
      recorder.current = await startRecorder(stream, { onLevel: setLevel, onAutoStop: () => stop(), silenceMs: 900, noSpeechMs: 5000, maxMs: 8000 });
      setPhase("recording");
    } catch (e) {
      setError(micErrorMessage(e));
    }
  }

  async function stop() {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setPhase("checking");
    try {
      const heard = rec.heardSpeech;
      const wav = await rec.stop();
      if (!heard) {
        setError("Không nghe thấy giọng của bạn, hãy thử lại.");
        return;
      }
      const res = await api.assess(itemId, wav, word);
      const tok = res.tokens.find((t) => t.status !== "skip");
      const score = Math.round(tok?.score ?? res.scores.accuracyScore);
      const ok = tok ? tok.status === "ok" : res.passed;
      setResults((r) => ({ ...r, [word]: { score, ok } }));
      if (ok) window.setTimeout(() => advance(), 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chấm được");
    } finally {
      setPhase("idle");
    }
  }

  function advance() {
    if (i + 1 < words.length) setI((x) => x + 1);
    else setStage("done");
  }

  const nextBtn = hasNext && (
    <button onClick={onNext} className="rounded-xl px-4 py-2.5 font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
      Câu tiếp →
    </button>
  );

  if (stage === "offer") {
    return (
      <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
        <p className="text-sm text-slate-700">
          ✓ Bạn đạt rồi! Chỉ còn <b>{words.length}</b> từ chưa thật chuẩn:{" "}
          {words.map((w) => (
            <b key={w} className="mr-1.5 font-bold text-red-600">
              {w}
            </b>
          ))}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setStage("drill")} className="rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500">
            🎯 Luyện {words.length > 1 ? "các từ này" : "từ này"}
          </button>
          {nextBtn}
        </div>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
        <p className="font-semibold text-emerald-700">🎉 Xong! Bạn đã luyện lại {words.length} từ.</p>
        <p className="mt-1 flex flex-wrap gap-2 text-sm">
          {words.map((w) => (
            <span key={w} className="rounded-full bg-surface px-2.5 py-0.5 ring-1 ring-slate-200">
              {w} <b className={results[w]?.ok ? "text-emerald-600" : "text-amber-700"}>{results[w]?.score ?? "–"}</b>
            </span>
          ))}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {nextBtn}
          <button
            onClick={() => {
              setI(0);
              setResults({});
              setStage("drill");
            }}
            className="rounded-xl px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            ↺ Luyện lại
          </button>
        </div>
      </div>
    );
  }

  const res = results[word];
  return (
    <div className="rounded-2xl bg-slate-100 p-5">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Luyện từ {i + 1}/{words.length}
        </span>
        <button onClick={() => setStage("done")} className="hover:text-slate-700">
          Bỏ qua phần luyện từ
        </button>
      </div>
      <p className="mt-3 text-center text-4xl font-bold text-slate-900">{word}</p>
      <div className="mt-2 flex justify-center gap-2 text-sm">
        <button onClick={() => listen(false)} className="rounded-lg px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-surface">
          🔊 Nghe
        </button>
        <button onClick={() => listen(true)} className="rounded-lg px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-surface">
          🐢 Chậm
        </button>
      </div>

      <div className="mt-5 flex min-h-[3.5rem] items-center justify-center gap-4">
        {phase === "recording" ? (
          <button
            onClick={stop}
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white"
            style={{ transform: `scale(${1 + level * 0.2})` }}
            title="Xong"
          >
            <span className="animate-pulse-ring absolute inset-0 rounded-full bg-red-400" />■
          </button>
        ) : phase === "checking" ? (
          <Spinner className="h-8 w-8" />
        ) : (
          <button onClick={record} className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-2xl text-white hover:bg-indigo-500" title="Đọc từ này">
            🎤
          </button>
        )}
        {res && phase === "idle" && (
          <div className="text-left">
            <p className={`text-3xl font-bold ${res.ok ? "text-emerald-600" : "text-amber-700"}`}>{res.score}</p>
            <p className="text-xs text-slate-500">{res.ok ? "Chuẩn rồi! ✓" : "Gần được rồi, thử lại nhé"}</p>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}
      {res && !res.ok && phase === "idle" && (
        <div className="mt-3 flex justify-center">
          <button onClick={advance} className="text-sm text-slate-500 hover:text-slate-800">
            {i + 1 < words.length ? "Sang từ tiếp →" : "Kết thúc"}
          </button>
        </div>
      )}
    </div>
  );
}
