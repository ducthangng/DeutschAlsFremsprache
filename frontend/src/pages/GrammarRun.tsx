import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import SelectionLookup from "../components/SelectionLookup";
import Spinner from "../components/Spinner";
import {
  api,
  type ChoiceQuestion,
  type GrammarAnswers,
  type GrammarContent,
  type GrammarSection,
  type GrammarSet,
  type ListeningQuestion,
  type RearrangeQuestion,
} from "../lib/api";
import { speak, type Playback } from "../lib/audio";
import { formatUsd } from "../lib/format";
import { usePrefs } from "../lib/prefs";
import { SECTIONS, sectionSummary } from "./Grammar";

const EMPTY: GrammarAnswers = { multipleChoice: {}, rearrange: {}, reading: {}, listening: {}, writing: {}, checked: {} };

/** Typed answers match ignoring case, spacing, quotes and the final punctuation mark. */
function norm(s: string) {
  return s
    .normalize("NFC")
    .replace(/[„“”"«»]/g, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const matches = (input: string, accepted: string[]) => !!input.trim() && accepted.some((a) => norm(a) === norm(input));

type Score = { right: number; total: number };

function scores(c: GrammarContent, a: GrammarAnswers, writingPoints: number | null): Partial<Record<GrammarSection, Score>> {
  const out: Partial<Record<GrammarSection, Score>> = {};
  const choice = (qs: ChoiceQuestion[], ans: Record<number, number>) => ({ right: qs.filter((q, i) => ans[i] === q.answer).length, total: qs.length });
  if (c.multipleChoice.length) out.multipleChoice = choice(c.multipleChoice, a.multipleChoice);
  if (c.rearrange.length) out.rearrange = { right: c.rearrange.filter((q, i) => matches(a.rearrange[i] ?? "", [q.answer, ...q.alternatives])).length, total: c.rearrange.length };
  if (c.reading?.questions.length) out.reading = choice(c.reading.questions, a.reading);
  if (c.listening?.questions.length)
    out.listening = { right: c.listening.questions.filter((q, i) => listeningCorrect(q, a.listening[i])).length, total: c.listening.questions.length };
  if (c.writing.length && writingPoints !== null) out.writing = { right: writingPoints, total: c.writing.length * 10 };
  return out;
}

function listeningCorrect(q: ListeningQuestion, a: number | string | undefined) {
  return q.kind === "choice" ? a === q.answer : typeof a === "string" && matches(a, q.accepted);
}

/** Work through a generated grammar set; answers are saved as you go. */
export default function GrammarRun() {
  const id = Number(useParams().id);
  const [set, setSet] = useState<GrammarSet | null>(null);
  const [answers, setAnswers] = useState<GrammarAnswers>(EMPTY);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const dirty = useRef(false);
  const navigate = useNavigate();
  const [prefs] = usePrefs();

  // Load, and poll while the set is being generated.
  useEffect(() => {
    let timer = 0;
    let alive = true;
    const load = () =>
      api.getGrammarSet(id).then(
        (g) => {
          if (!alive) return;
          setSet(g);
          if (g.status === "generating") timer = window.setTimeout(load, 2500);
          else if (g.answers) setAnswers({ ...EMPTY, ...g.answers });
        },
        (e) => alive && setError(e.message),
      );
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  // Save answers shortly after the learner stops typing.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => api.saveGrammarAnswers(id, answers).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [id, answers]);

  const update = (fn: (a: GrammarAnswers) => GrammarAnswers) => {
    dirty.current = true;
    setAnswers(fn);
  };
  const answer = (section: GrammarSection, i: number, v: number | string) =>
    update((a) => ({ ...a, [section]: { ...a[section], [i]: v } }) as GrammarAnswers);
  const setChecked = (section: GrammarSection, on: boolean) =>
    update((a) => ({ ...a, checked: { ...a.checked, [section]: on }, ...(on ? {} : { [section]: {} }) }));

  async function retry() {
    if (!set) return;
    setRetrying(true);
    try {
      const g = await api.createGrammarSet({ grammar: set.grammar, level: set.level, model: set.model, sections: set.sections });
      navigate(`/grammar/${g.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo lại được");
    } finally {
      setRetrying(false);
    }
  }

  if (error && !set) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;
  if (!set) return <Spinner className="mx-auto mt-24" />;

  const back = (
    <Link to="/grammar" className="text-sm text-slate-400 hover:text-slate-800">
      ← Ngữ pháp
    </Link>
  );

  if (set.status === "generating") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="text-left">{back}</div>
        <Spinner className="mx-auto mt-16 h-10 w-10" />
        <h1 className="mt-6 text-2xl font-bold text-slate-900">AI đang soạn bài “{set.grammar}”</h1>
        <p className="mt-2 text-slate-500">
          {set.level} · {set.model} · {sectionSummary(set.sections)}
        </p>
        <p className="mt-6 text-sm text-slate-400">Các phần được soạn song song, bài nghe được thu âm sau cùng. Thường mất 30 giây đến 2 phút; bạn có thể rời trang và quay lại sau.</p>
      </div>
    );
  }

  if (set.status === "failed" || !set.content) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        {back}
        <h1 className="mt-8 text-2xl font-bold text-slate-900">Không tạo được bài</h1>
        <p className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{set.error || "Lỗi không xác định"}</p>
        <button onClick={retry} disabled={retrying} className="mt-6 rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {retrying ? "Đang gửi…" : "↻ Tạo lại với cùng thiết lập"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const c = set.content;
  const fb = set.writingFeedback ?? null;
  const writingPoints = fb ? fb.items.reduce((s, x) => s + x.score, 0) : null;
  const sc = scores(c, answers, writingPoints);
  const present = SECTIONS.filter((x) => sc[x.key] || (x.key === "writing" && c.writing.length));

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-8">
      {/* double-click a German word: listen, meaning, save to the Pocket */}
      <SelectionLookup language="de-DE" rate={prefs.rate} voiceURI={prefs.voice["de-DE"] || undefined} />
      {back}
      <header className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          {set.level} · {set.grammar}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">{c.title}</h1>
        <p className="mt-1 text-xs text-slate-400">
          {set.model} · chi phí ≈ {formatUsd(set.costUsd)}
        </p>
      </header>

      {/* section navigation with scores of checked sections */}
      <nav className="sticky top-14 z-10 -mx-4 mt-6 flex gap-2 overflow-x-auto bg-slate-50/85 px-4 py-2 backdrop-blur no-scrollbar">
        {present.map((x) => {
          const s = sc[x.key];
          const done = answers.checked[x.key] || (x.key === "writing" && fb);
          return (
            <a key={x.key} href={`#${x.key}`} className="whitespace-nowrap rounded-full bg-surface px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300">
              {x.icon} {x.label}
              {done && s && (
                <b className="ml-1.5 text-indigo-700">
                  {s.right}/{s.total}
                </b>
              )}
            </a>
          );
        })}
      </nav>

      {c.errors && Object.keys(c.errors).length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {Object.entries(c.errors).map(([k, v]) => (
            <p key={k}>
              ⚠ {SECTIONS.find((x) => x.key === k)?.label ?? (k === "listeningAudio" ? "Audio bài nghe" : "Phần giải thích")}: {v}
            </p>
          ))}
        </div>
      )}

      {c.overview && (
        <details className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-slate-200" open={!set.started}>
          <summary className="cursor-pointer font-semibold text-slate-900">📘 Kiến thức cần nhớ</summary>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-600">{c.overview}</p>
        </details>
      )}

      {c.multipleChoice.length > 0 && (
        <Section id="multipleChoice" score={sc.multipleChoice} checked={!!answers.checked.multipleChoice} onCheck={setChecked}>
          <ChoiceList
            questions={c.multipleChoice}
            answers={answers.multipleChoice}
            checked={!!answers.checked.multipleChoice}
            onAnswer={(i, v) => answer("multipleChoice", i, v)}
          />
        </Section>
      )}

      {c.rearrange.length > 0 && (
        <Section id="rearrange" score={sc.rearrange} checked={!!answers.checked.rearrange} onCheck={setChecked}>
          <ol className="space-y-5">
            {c.rearrange.map((q, i) => (
              <RearrangeItem key={i} n={i + 1} q={q} value={answers.rearrange[i] ?? ""} checked={!!answers.checked.rearrange} onChange={(v) => answer("rearrange", i, v)} />
            ))}
          </ol>
        </Section>
      )}

      {c.reading && c.reading.questions.length > 0 && (
        <Section id="reading" score={sc.reading} checked={!!answers.checked.reading} onCheck={setChecked}>
          <article className="rounded-xl bg-slate-100 p-5">
            <h3 className="text-lg font-semibold text-slate-900">{c.reading.title}</h3>
            <p data-lookup className="mt-3 whitespace-pre-line leading-relaxed text-slate-700 selection:bg-amber-200">
              {c.reading.passage}
            </p>
          </article>
          <div className="mt-6">
            <ChoiceList questions={c.reading.questions} answers={answers.reading} checked={!!answers.checked.reading} onAnswer={(i, v) => answer("reading", i, v)} />
          </div>
        </Section>
      )}

      {c.listening && c.listening.questions.length > 0 && (
        <Section id="listening" score={sc.listening} checked={!!answers.checked.listening} onCheck={setChecked}>
          <Listening
            listening={c.listening}
            audioUrl={set.audioUrl}
            answers={answers.listening}
            checked={!!answers.checked.listening}
            onAnswer={(i, v) => answer("listening", i, v)}
          />
        </Section>
      )}

      {c.writing.length > 0 && (
        <Writing
          set={set}
          tasks={c.writing}
          answers={answers.writing}
          onAnswer={(i, v) => answer("writing", i, v)}
          onGraded={(writingFeedback, costUsd) => setSet((g) => g && { ...g, writingFeedback, costUsd: g.costUsd + costUsd })}
        />
      )}
    </div>
  );
}

// ---------------- building blocks ----------------

function Section({
  id,
  score,
  checked,
  onCheck,
  children,
}: {
  id: GrammarSection;
  score?: Score;
  checked: boolean;
  onCheck: (s: GrammarSection, on: boolean) => void;
  children: ReactNode;
}) {
  const meta = SECTIONS.find((x) => x.key === id)!;
  return (
    <section id={id} className="mt-10 scroll-mt-28 rounded-3xl bg-surface p-6 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-slate-900">
          {meta.icon} {meta.label}
        </h2>
        <span className="text-sm text-slate-400">{meta.hint}</span>
      </div>
      {children}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
        {checked ? (
          <>
            {score && (
              <span className="text-lg font-semibold text-slate-900">
                {score.right}/{score.total} câu đúng
              </span>
            )}
            <button onClick={() => onCheck(id, false)} className="rounded-xl px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
              ↻ Làm lại phần này
            </button>
          </>
        ) : (
          <button onClick={() => onCheck(id, true)} className="rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-500">
            Kiểm tra đáp án
          </button>
        )}
      </div>
    </section>
  );
}

function Explanation({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{children}</div>;
}

function ChoiceList({
  questions,
  answers,
  checked,
  onAnswer,
}: {
  questions: ChoiceQuestion[];
  answers: Record<number, number>;
  checked: boolean;
  onAnswer: (i: number, v: number) => void;
}) {
  return (
    <ol className="space-y-6">
      {questions.map((q, i) => (
        <li key={i}>
          <p data-lookup data-sentence={q.question.includes("___") ? "" : q.question} className="font-medium text-slate-900 selection:bg-amber-200">
            <span className="mr-2 text-slate-400">{i + 1}.</span>
            {q.question}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {q.options.map((o, j) => {
              const picked = answers[i] === j;
              const tone = !checked
                ? picked
                  ? "bg-indigo-50 ring-indigo-400 text-indigo-800"
                  : "ring-slate-200 hover:ring-indigo-300 text-slate-700"
                : j === q.answer
                  ? "bg-emerald-50 ring-emerald-400 text-emerald-800"
                  : picked
                    ? "bg-red-50 ring-red-400 text-red-800"
                    : "ring-slate-200 text-slate-400";
              return (
                <button key={j} disabled={checked} onClick={() => onAnswer(i, j)} className={`rounded-xl px-4 py-2 text-left ring-1 transition ${tone}`}>
                  <span className="mr-2 text-xs opacity-60">{"ABCD"[j] ?? j + 1}</span>
                  {o}
                </button>
              );
            })}
          </div>
          {checked && (
            <Explanation ok={answers[i] === q.answer}>
              {answers[i] === undefined && "Chưa trả lời. "}
              {q.explanation}
            </Explanation>
          )}
        </li>
      ))}
    </ol>
  );
}

function RearrangeItem({ n, q, value, checked, onChange }: { n: number; q: RearrangeQuestion; value: string; checked: boolean; onChange: (v: string) => void }) {
  const ok = matches(value, [q.answer, ...q.alternatives]);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-slate-400">{n}.</span>
        {q.fragments.map((f, i) => (
          <span key={i} className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-800 ring-1 ring-slate-200">
            {f}
          </span>
        ))}
      </div>
      <input
        value={value}
        disabled={checked}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Gõ câu hoàn chỉnh…"
        spellCheck={false}
        className={`mt-2 w-full rounded-lg border bg-transparent px-3 py-2 outline-none focus:border-indigo-500 ${
          checked ? (ok ? "border-emerald-400 text-emerald-700" : "border-red-400 text-red-700") : "border-slate-300"
        }`}
      />
      {checked && (
        <Explanation ok={ok}>
          {!ok && (
            <p>
              Đáp án:{" "}
              <b data-lookup data-sentence={q.answer}>
                {q.answer}
              </b>
              {q.alternatives.length > 0 && <> (hoặc: {q.alternatives.join(" / ")})</>}
            </p>
          )}
          <p className="opacity-80">
            {q.translation} · {q.explanation}
          </p>
        </Explanation>
      )}
    </li>
  );
}

function Listening({
  listening,
  audioUrl,
  answers,
  checked,
  onAnswer,
}: {
  listening: NonNullable<GrammarContent["listening"]>;
  audioUrl?: string;
  answers: Record<number, number | string>;
  checked: boolean;
  onAnswer: (i: number, v: number | string) => void;
}) {
  const [prefs] = usePrefs();
  const [rate, setRate] = useState(1);
  const [showScript, setShowScript] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const playback = useRef<Playback | null>(null);
  useEffect(() => () => playback.current?.stop(), []);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  function browserSpeak() {
    if (speaking) {
      playback.current?.stop();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    playback.current = speak(listening.segments.map((s) => s.text).join(" "), { lang: "de-DE", rate: rate * prefs.rate, voiceURI: prefs.voice["de-DE"] || undefined });
    playback.current.done.finally(() => setSpeaking(false));
  }

  return (
    <>
      <div className="rounded-xl bg-slate-100 p-5">
        <h3 className="font-semibold text-slate-900">{listening.title}</h3>
        {listening.situation && <p className="mt-1 text-sm text-slate-500">{listening.situation}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {audioUrl ? (
            <audio ref={audio} controls preload="auto" src={audioUrl} className="w-full max-w-md" onLoadedMetadata={(e) => (e.currentTarget.playbackRate = rate)} />
          ) : (
            <button onClick={browserSpeak} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              {speaking ? "■ Dừng" : "🔊 Nghe (giọng trình duyệt)"}
            </button>
          )}
          <div className="flex gap-1 rounded-lg bg-surface p-1 text-xs ring-1 ring-slate-200">
            {[0.75, 0.9, 1].map((r) => (
              <button key={r} onClick={() => setRate(r)} className={`rounded px-2 py-1 ${rate === r ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                {r}×
              </button>
            ))}
          </div>
          <button onClick={() => setShowScript((s) => !s)} className="text-sm text-slate-500 underline hover:text-slate-800">
            {showScript ? "Ẩn lời thoại" : checked ? "Xem lời thoại" : "Xem lời thoại (nên làm bài trước)"}
          </button>
        </div>
        {showScript && (
          <div className="mt-4 space-y-1.5 border-t border-slate-200 pt-4 text-slate-700">
            {listening.segments.map((s, i) => (
              <p key={i}>
                {s.speaker && <b className="text-slate-900">{s.speaker}: </b>}
                <span data-lookup data-sentence={s.text} className="selection:bg-amber-200">
                  {s.text}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <ol className="mt-6 space-y-6">
        {listening.questions.map((q, i) =>
          q.kind === "choice" ? (
            <li key={i}>
              <p data-lookup data-sentence={q.question} className="font-medium text-slate-900 selection:bg-amber-200">
                <span className="mr-2 text-slate-400">{i + 1}.</span>
                {q.question}
              </p>
              <ChoiceOptions q={q} picked={answers[i] as number | undefined} checked={checked} onPick={(j) => onAnswer(i, j)} />
              {checked && <Explanation ok={answers[i] === q.answer}>{q.explanation}</Explanation>}
            </li>
          ) : (
            <BlankItem key={i} n={i + 1} q={q} value={(answers[i] as string) ?? ""} checked={checked} onChange={(v) => onAnswer(i, v)} />
          ),
        )}
      </ol>
    </>
  );
}

function ChoiceOptions({ q, picked, checked, onPick }: { q: ListeningQuestion; picked?: number; checked: boolean; onPick: (j: number) => void }) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {q.options.map((o, j) => {
        const tone = !checked
          ? picked === j
            ? "bg-indigo-50 ring-indigo-400 text-indigo-800"
            : "ring-slate-200 hover:ring-indigo-300 text-slate-700"
          : j === q.answer
            ? "bg-emerald-50 ring-emerald-400 text-emerald-800"
            : picked === j
              ? "bg-red-50 ring-red-400 text-red-800"
              : "ring-slate-200 text-slate-400";
        return (
          <button key={j} disabled={checked} onClick={() => onPick(j)} className={`rounded-xl px-4 py-2 text-left ring-1 transition ${tone}`}>
            <span className="mr-2 text-xs opacity-60">{"ABCD"[j] ?? j + 1}</span>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** A sentence from the recording with an input in place of "___". */
function BlankItem({ n, q, value, checked, onChange }: { n: number; q: ListeningQuestion; value: string; checked: boolean; onChange: (v: string) => void }) {
  const [before, ...rest] = q.question.split("___");
  const after = rest.join("___");
  const ok = matches(value, q.accepted);
  return (
    <li>
      <p className="leading-loose text-slate-900">
        <span className="mr-2 text-slate-400">{n}.</span>
        {before}
        <input
          value={value}
          disabled={checked}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label={`Điền từ câu ${n}`}
          className={`mx-1 w-40 rounded-md border-b-2 bg-slate-100 px-2 py-0.5 outline-none focus:border-indigo-500 ${
            checked ? (ok ? "border-emerald-500 text-emerald-700" : "border-red-500 text-red-700") : "border-slate-300"
          }`}
        />
        {after}
      </p>
      {checked && (
        <Explanation ok={ok}>
          {!ok && (
            <p>
              Đáp án: <b>{q.accepted.join(" / ")}</b>
            </p>
          )}
          {q.explanation && <p className="opacity-80">{q.explanation}</p>}
        </Explanation>
      )}
    </li>
  );
}

const VERDICT = {
  correct: { label: "Đúng", cls: "bg-emerald-50 text-emerald-800" },
  minor: { label: "Gần đúng", cls: "bg-amber-50 text-amber-800" },
  wrong: { label: "Sai", cls: "bg-red-50 text-red-800" },
};

function Writing({
  set,
  tasks,
  answers,
  onAnswer,
  onGraded,
}: {
  set: GrammarSet;
  tasks: GrammarContent["writing"];
  answers: Record<number, string>;
  onAnswer: (i: number, v: string) => void;
  onGraded: (fb: NonNullable<GrammarSet["writingFeedback"]>, costUsd: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hints, setHints] = useState<Set<number>>(new Set());
  const fb = set.writingFeedback;
  const filled = tasks.filter((_, i) => (answers[i] ?? "").trim()).length;
  const total = fb ? fb.items.reduce((s, x) => s + x.score, 0) : 0;

  async function grade() {
    setBusy(true);
    setError("");
    try {
      const res = await api.gradeGrammarWriting(set.id, tasks.map((_, i) => answers[i] ?? ""));
      onGraded(res.writingFeedback, res.costUsd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chấm được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="writing" className="mt-10 scroll-mt-28 rounded-3xl bg-surface p-6 ring-1 ring-slate-200 sm:p-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-slate-900">✍️ Viết: dịch sang tiếng Đức</h2>
        <span className="text-sm text-slate-400">AI chấm theo nghĩa và ngữ pháp, không chỉ so với đáp án mẫu</span>
      </div>
      <ol className="space-y-6">
        {tasks.map((t, i) => {
          const item = fb?.items[i];
          const stale = item && (fb!.answers[i] ?? "") !== (answers[i] ?? "").trim();
          return (
            <li key={i}>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-slate-900">
                  <span className="mr-2 text-slate-400">{i + 1}.</span>
                  {t.english}
                </p>
                {t.hint && (
                  <button
                    onClick={() => setHints((h) => new Set(h).add(i))}
                    className="shrink-0 text-xs text-slate-400 hover:text-slate-700"
                    disabled={hints.has(i)}
                  >
                    💡 Gợi ý
                  </button>
                )}
              </div>
              {hints.has(i) && <p className="mt-1 text-sm text-slate-500">💡 {t.hint}</p>}
              <textarea
                value={answers[i] ?? ""}
                onChange={(e) => onAnswer(i, e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="Câu tiếng Đức của bạn…"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500"
              />
              {item && (
                <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${VERDICT[item.verdict].cls}`}>
                  <p className="font-semibold">
                    {VERDICT[item.verdict].label} · {item.score}/10{stale && <span className="ml-2 font-normal opacity-70">(bạn đã sửa câu này sau khi chấm)</span>}
                  </p>
                  {item.verdict !== "correct" && item.corrected && (
                    <p className="mt-1">
                      Sửa lại: <b>{item.corrected}</b>
                    </p>
                  )}
                  <p className="mt-1 opacity-90">{item.feedback}</p>
                  <p className="mt-1 opacity-70">Đáp án mẫu: {t.german}</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
        {fb && (
          <span className="text-lg font-semibold text-slate-900">
            {total}/{tasks.length * 10} điểm
          </span>
        )}
        <button onClick={grade} disabled={busy || filled === 0} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {busy ? (
            <>
              <Spinner className="h-4 w-4 border-white/30 border-t-white" /> Đang chấm…
            </>
          ) : fb ? (
            "↻ Chấm lại"
          ) : (
            `🤖 Chấm bằng AI (${filled}/${tasks.length})`
          )}
        </button>
        <span className="text-xs text-slate-400">Dùng model {set.model}, có tính phí.</span>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
