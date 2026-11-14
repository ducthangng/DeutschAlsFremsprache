import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal, useDialog } from "../components/Dialog";
import Spinner from "../components/Spinner";
import { api, type GrammarModels, type GrammarSection, type GrammarSections, type GrammarSet, type VocabEntry, type VocabPackage } from "../lib/api";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Common grammar points per level, as one-click suggestions. */
const SUGGESTIONS: Record<string, string[]> = {
  A1: ["Verbposition im Hauptsatz", "Nominativ & Akkusativ", "Modalverben", "Trennbare Verben", "Possessivartikel"],
  A2: ["Perfekt mit haben/sein", "Dativ", "Wechselpräpositionen", "Nebensätze mit weil/dass", "Komparativ & Superlativ", "Reflexive Verben"],
  B1: ["Präteritum", "Konjunktiv II", "Relativsätze", "Passiv Präsens", "Adjektivdeklination", "Infinitiv mit zu"],
  B2: ["Passiv mit Modalverben", "Konjunktiv I (indirekte Rede)", "Partizipialattribute", "Nominalisierung", "Zweiteilige Konnektoren"],
  C1: ["Partizipialkonstruktionen", "Funktionsverbgefüge", "Modalpartikeln", "Konjunktiv I & II", "Nominalstil"],
  C2: ["Erweiterte Partizipialattribute", "Subjektive Modalverben", "Funktionsverbgefüge", "Modalpartikeln", "Konzessive Konstruktionen"],
};

export const SECTIONS: { key: GrammarSection; icon: string; label: string; hint: string }[] = [
  { key: "multipleChoice", icon: "🔘", label: "Trắc nghiệm", hint: "Chọn 1 trong 4 đáp án" },
  { key: "rearrange", icon: "🔀", label: "Sắp xếp câu", hint: "Bấm từng ô theo đúng thứ tự để ghép câu" },
  { key: "reading", icon: "📖", label: "Đọc hiểu", hint: "1 bài đọc + câu hỏi trắc nghiệm" },
  { key: "listening", icon: "🎧", label: "Nghe hiểu", hint: "1 bài nghe + trắc nghiệm & điền từ" },
  { key: "writing", icon: "✍️", label: "Viết (dịch Anh → Đức)", hint: "AI chấm từng câu" },
];

const DEFAULT_COUNTS: GrammarSections = { multipleChoice: 10, rearrange: 10, reading: 10, listening: 10, writing: 10 };

/** At most this many own words go into one set (the API refuses more). */
const MAX_WORDS = 80; // backend limit per exercise set

/** A Pocket package id, or "none" for the words without a package. */
type PackageKey = number | "none";

const price = (v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 ? 2 : 0)}`;

const LEVEL_COLOR: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-rose-100 text-rose-700",
};

/** A set in its level column: status, overall progress, and every part as a shortcut. */
function GrammarCard({ g, onDelete }: { g: GrammarSet; onDelete: () => void }) {
  const parts = SECTIONS.filter((x) => g.sections[x.key] > 0);
  const p = g.progress ?? {};
  const answered = parts.reduce((s, x) => s + (p[x.key]?.answered ?? 0), 0);
  const questions = parts.reduce((s, x) => s + (p[x.key]?.questions ?? g.sections[x.key]), 0);
  const finished = parts.length > 0 && parts.every((x) => p[x.key]?.checked);
  const ready = g.status === "ready";
  return (
    <li className="relative rounded-2xl bg-surface ring-1 ring-slate-200 transition hover:ring-indigo-300">
      <Link to={`/grammar/${g.id}`} className="block p-4 pb-3">
        <div className="pr-8 text-xs">
          <span className={ready ? (finished ? "text-emerald-600" : g.started ? "text-indigo-600" : "text-slate-400") : g.status === "failed" ? "text-red-500" : "text-amber-700"}>
            {ready ? (finished ? "✓ Đã xong" : g.started ? "Đang làm" : "Chưa làm") : g.status === "failed" ? "Lỗi" : "Đang tạo…"}
          </span>
          {g.pending && <span className="text-amber-700"> · đang soạn 1 phần…</span>}
          <span className="text-slate-400"> · {new Date(g.createdAt).toLocaleDateString("vi-VN")}</span>
        </div>
        <h4 className="mt-1 pr-6 font-semibold leading-snug text-slate-900">{g.title || g.grammar}</h4>
        {g.title && g.title !== g.grammar && <p className="text-sm text-slate-500">{g.grammar}</p>}
        {ready && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" title={`${answered}/${questions} câu đã làm`}>
            <div className={`h-full rounded-full ${finished ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${questions ? (100 * answered) / questions : 0}%` }} />
          </div>
        )}
      </Link>
      {ready ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-4">
          {parts.map((x) => {
            const q = p[x.key];
            return (
              <Link
                key={x.key}
                to={`/grammar/${g.id}?part=${x.key}`}
                title={`${x.label}: làm phần này`}
                className={`rounded-full px-2.5 py-1 text-xs ring-1 transition hover:ring-indigo-400 ${
                  q?.checked ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-50 text-slate-600 ring-slate-200"
                }`}
              >
                {x.icon} {q?.checked ? `${q.right}/${q.max}` : `${q?.answered ?? 0}/${q?.questions ?? g.sections[x.key]}`}
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="px-4 pb-4 text-xs text-slate-400">{sectionSummary(g.sections)}</p>
      )}
      <button
        onClick={onDelete}
        className="absolute right-2 top-2 rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-red-50 hover:text-red-500"
        title="Xoá bài"
        aria-label={`Xoá bài ${g.title || g.grammar}`}
      >
        🗑
      </button>
    </li>
  );
}

export function sectionSummary(s: GrammarSections) {
  return SECTIONS.filter((x) => s[x.key] > 0)
    .map((x) => `${x.icon} ${s[x.key]}`)
    .join("  ");
}

/** Choose a grammar point, level, model and question types, and browse past sets. */
export default function Grammar() {
  const [meta, setMeta] = useState<GrammarModels | null>(null);
  const [sets, setSets] = useState<GrammarSet[] | null>(null);
  const [grammar, setGrammar] = useState("");
  const [level, setLevel] = useState("B1");
  const [model, setModel] = useState("");
  const [counts, setCounts] = useState<GrammarSections>(DEFAULT_COUNTS);
  const [enabled, setEnabled] = useState<Record<GrammarSection, boolean>>({ multipleChoice: true, rearrange: true, reading: true, listening: true, writing: true });
  // Vocabulary: a CEFR word list ("" = same as level) or the words of Pocket packages.
  const [vocabSource, setVocabSource] = useState<"level" | "pocket">("level");
  const [vocabLevel, setVocabLevel] = useState("");
  const [pocket, setPocket] = useState<VocabEntry[] | null>(null);
  const [packages, setPackages] = useState<VocabPackage[]>([]);
  const [pickedPkgs, setPickedPkgs] = useState<Set<PackageKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const dialog = useDialog();

  useEffect(() => {
    api.grammarModels().then((m) => {
      setMeta(m);
      setModel((cur) => cur || m.defaultModel);
    }, (e) => setError(e.message));
    api.grammarSets().then((s) => {
      setSets(s);
      if (s[0]) setLevel(s[0].level);
    }, (e) => setError(e.message));
    api.listVocab().then((v) => setPocket(v.filter((x) => x.language === "de-DE")), () => setPocket([]));
    api.vocabPackages().then(setPackages, () => {});
  }, []);

  const sections = Object.fromEntries(SECTIONS.map((x) => [x.key, enabled[x.key] ? counts[x.key] : 0])) as GrammarSections;
  const total = Object.values(sections).reduce((a, b) => a + b, 0);
  const chosen = meta?.models.find((m) => m.id === model);
  const ownWords = vocabSource === "pocket";

  // German words per package ("none" = words without a package); only packages with German words are offered.
  const byPackage = useMemo(() => {
    const m = new Map<PackageKey, VocabEntry[]>();
    for (const v of pocket ?? []) {
      const k = v.packageId ?? "none";
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return m;
  }, [pocket]);
  const packageChoices: { key: PackageKey; name: string; words: VocabEntry[] }[] = [
    ...packages.map((p) => ({ key: p.id as PackageKey, name: `📦 ${p.name}`, words: byPackage.get(p.id) ?? [] })),
    { key: "none" as PackageKey, name: "Chưa phân loại", words: byPackage.get("none") ?? [] },
  ].filter((c) => c.words.length > 0);
  const poolSize = packageChoices.filter((c) => pickedPkgs.has(c.key)).reduce((n, c) => n + c.words.length, 0);

  function togglePackage(key: PackageKey) {
    setPickedPkgs((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** The words of the chosen packages; above the limit, words not yet learnt well come first, at random. */
  function packageWords(): string[] {
    const pool = packageChoices.filter((c) => pickedPkgs.has(c.key)).flatMap((c) => c.words);
    const terms = [...new Map(pool.map((v) => [v.term.toLowerCase(), v])).values()];
    if (terms.length <= MAX_WORDS) return terms.map((v) => v.term);
    const shuffled = terms.map((v) => ({ v, r: Math.random() + (v.state === "mature" ? 1 : 0) })).sort((a, b) => a.r - b.r);
    return shuffled.slice(0, MAX_WORDS).map((x) => x.v.term);
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const g = await api.createGrammarSet({
        grammar: grammar.trim(),
        level,
        model,
        sections,
        ...(ownWords ? { vocabulary: packageWords() } : { vocabLevel: vocabLevel || level }),
      });
      navigate(`/grammar/${g.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được bài");
      setBusy(false);
    }
  }

  async function remove(g: GrammarSet) {
    if (!(await confirmDeleteGrammar(dialog, g))) return;
    setSets((s) => s?.filter((x) => x.id !== g.id) ?? null);
  }

  const field = "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/30";

  return (
    <div className="px-4 pb-20 pt-10 sm:px-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0c2a43] via-[#15161f] to-[#0d0e12] p-8 ring-1 ring-white/5 sm:p-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">Ngữ pháp</p>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold text-white sm:text-4xl">Bộ bài tập ngữ pháp tiếng Đức, soạn riêng cho bạn</h1>
            <p className="mt-3 max-w-2xl text-white/60">
              AI soạn trắc nghiệm, sắp xếp câu, bài đọc, bài nghe (giọng đọc Microsoft) và bài dịch Anh → Đức theo chủ điểm và trình độ bạn chọn.
            </p>
          </div>
          <button onClick={() => setCreating(true)} className="shrink-0 rounded-xl bg-white px-6 py-2.5 font-semibold text-black hover:bg-white/85">
            ＋ Tạo bài mới
          </button>
        </div>
      </section>

      <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-800">Bài đã tạo</h2>
      {!sets && !error && <Spinner />}
      {!sets && error && <p className="text-sm text-red-500">{error}</p>}
      {sets?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
          <p className="text-slate-500">Chưa có bài nào.</p>
          <button onClick={() => setCreating(true)} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white hover:bg-indigo-500">
            ＋ Tạo bộ bài tập đầu tiên
          </button>
        </div>
      )}
      {/* one column per level, A1 → C2: pick a set (or straight a part of it) */}
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4">
        {LEVELS.filter((lv) => sets?.some((g) => g.level === lv)).map((lv) => {
          const inLevel = sets!.filter((g) => g.level === lv);
          return (
            <section key={lv} className="w-[19rem] shrink-0 snap-start" aria-label={`Trình độ ${lv}`}>
              <h3 className="mb-2 flex items-baseline gap-2 px-1">
                <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${LEVEL_COLOR[lv[0]]}`}>{lv}</span>
                <span className="text-sm text-slate-400">{inLevel.length} bài</span>
              </h3>
              <ul className="space-y-3">
                {inLevel.map((g) => (
                  <GrammarCard key={g.id} g={g} onDelete={() => remove(g)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <Modal open={creating} onClose={() => !busy && setCreating(false)} title="Tạo bài ngữ pháp" width="max-w-3xl">
        <div className="-mx-6 max-h-[75vh] overflow-y-auto px-6 pb-1">
        <div className="space-y-7">
          <Field label="Chủ điểm ngữ pháp" htmlFor="grammar">
            <input
              id="grammar"
              value={grammar}
              onChange={(e) => setGrammar(e.target.value)}
              maxLength={200}
              placeholder="VD: Konjunktiv II, Relativsätze mit Präpositionen, Perfekt…"
              className={`${field} w-full px-4 placeholder:text-white/30`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTIONS[level].map((g) => (
                <button
                  key={g}
                  onClick={() => setGrammar(g)}
                  className={`rounded-full px-3 py-1 text-xs ring-1 ${grammar === g ? "bg-white text-black ring-white" : "text-white/60 ring-white/15 hover:text-white"}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Trình độ">
              <LevelPicker value={level} onChange={setLevel} />
            </Field>
            <Field label="Model" htmlFor="model">
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)} className={`${field} block h-[42px] w-full`}>
                {meta?.models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#15161f]">
                    {m.label}: {m.note}
                  </option>
                ))}
              </select>
              {chosen && (
                <p className="mt-1 text-xs text-white/40">
                  {chosen.priceEstimated ? "≈ " : ""}
                  {price(chosen.usdPerMInput)} / {price(chosen.usdPerMOutput)} mỗi 1M token vào / ra{chosen.priceEstimated && " (giá ước tính)"}
                </p>
              )}
            </Field>
          </div>

          <Field label="Từ vựng dùng trong bài">
            <div className="inline-flex gap-1 rounded-xl bg-white/5 p-1">
              {(
                [
                  ["level", "Theo khung A1–C2"],
                  ["pocket", "Package từ vựng của tôi"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setVocabSource(k)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium sm:px-4 ${vocabSource === k ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {ownWords ? (
              <div className="mt-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
                {!pocket ? (
                  <Spinner className="h-5 w-5" />
                ) : packageChoices.length === 0 ? (
                  <p className="text-sm text-white/50">
                    Pocket chưa có từ tiếng Đức nào.{" "}
                    <Link to="/pocket" className="text-indigo-300 underline hover:text-indigo-200">
                      Thêm từ vào Pocket
                    </Link>{" "}
                    hoặc dùng từ vựng theo khung.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                      <span>Chọn một hoặc nhiều package · AI sẽ đặt câu xoay quanh các từ trong đó</span>
                      <span className="flex gap-3">
                        <button onClick={() => setPickedPkgs(new Set(packageChoices.map((c) => c.key)))} className="hover:text-white">
                          Chọn tất cả
                        </button>
                        <button onClick={() => setPickedPkgs(new Set())} className="hover:text-white">
                          Bỏ chọn
                        </button>
                      </span>
                    </div>
                    <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                      {packageChoices.map((c) => {
                        const on = pickedPkgs.has(c.key);
                        return (
                          <button
                            key={String(c.key)}
                            onClick={() => togglePackage(c.key)}
                            aria-pressed={on}
                            title={c.words.slice(0, 12).map((v) => v.term).join(", ") + (c.words.length > 12 ? "…" : "")}
                            className={`rounded-xl px-3 py-2 text-left text-sm ring-1 ${on ? "bg-indigo-500/90 text-white ring-indigo-400" : "text-white/70 ring-white/15 hover:text-white"}`}
                          >
                            {on ? "✓ " : ""}
                            {c.name} <span className={on ? "text-white/70" : "text-white/40"}>· {c.words.length} từ</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-xs text-white/50">
                      {poolSize === 0
                        ? "Chưa chọn package nào."
                        : poolSize <= MAX_WORDS
                          ? `Bài sẽ dùng ${poolSize} từ.`
                          : `Các package đã chọn có ${poolSize} từ; mỗi bài dùng tối đa ${MAX_WORDS} từ, ưu tiên từ chưa thuộc, chọn ngẫu nhiên.`}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-3 grid gap-6 md:grid-cols-2">
                <div>
                  <LevelPicker value={vocabLevel || level} onChange={setVocabLevel} />
                  <p className="mt-1 text-xs text-white/40">Mặc định theo trình độ đã chọn ở trên.</p>
                </div>
              </div>
            )}
          </Field>

          <Field label="Dạng bài và số câu">
            <ul className="divide-y divide-white/5 overflow-hidden rounded-xl ring-1 ring-white/10">
              {SECTIONS.map((x) => {
                const on = enabled[x.key];
                return (
                  <li key={x.key} className={`flex items-center gap-4 px-4 py-3 transition ${on ? "bg-white/[0.07]" : "bg-white/[0.02]"}`}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setEnabled((s) => ({ ...s, [x.key]: e.target.checked }))}
                        className="h-4 w-4 shrink-0 accent-indigo-500"
                      />
                      <span className="w-6 shrink-0 text-center">{x.icon}</span>
                      <span className={`min-w-0 font-medium sm:w-44 sm:shrink-0 ${on ? "text-white" : "text-white/50"}`}>{x.label}</span>
                      <span className="hidden min-w-0 truncate text-sm text-white/40 sm:block">{x.hint}</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={meta?.limits[x.key] ?? 30}
                      disabled={!on}
                      value={counts[x.key]}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        setCounts((c) => ({ ...c, [x.key]: Math.min(meta?.limits[x.key] ?? 30, Math.max(1, n || 1)) }));
                      }}
                      aria-label={`Số câu ${x.label}`}
                      className="w-16 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-right text-white disabled:opacity-30"
                    />
                    <span className="hidden w-6 shrink-0 text-xs text-white/40 sm:block">câu</span>
                  </li>
                );
              })}
            </ul>
            {!meta?.listeningAudio && meta && enabled.listening && (
              <p className="mt-2 text-xs text-amber-500">Máy chủ chưa có AZURE_SPEECH_KEY: bài nghe sẽ do trình duyệt đọc.</p>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={create}
              disabled={busy || !meta?.enabled || grammar.trim().length < 2 || total === 0 || !model || (ownWords && poolSize === 0)}
              className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 font-semibold text-black hover:bg-white/85 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Spinner className="h-4 w-4 border-black/20 border-t-black" /> Đang gửi…
                </>
              ) : (
                `✨ Tạo bài (${total} câu)`
              )}
            </button>
            <button onClick={() => setCreating(false)} disabled={busy} className="rounded-xl px-4 py-2.5 text-white/60 hover:text-white disabled:opacity-50">
              Huỷ
            </button>
            <span className="text-sm text-white/40">Thường mất 30 giây đến 2 phút, tuỳ model.</span>
          </div>
          {meta && !meta.enabled && <p className="text-sm text-amber-500">Cần cấu hình OPENAI_API_KEY trên máy chủ để tạo bài ngữ pháp.</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        </div>
      </Modal>
    </div>
  );
}

/** Asks, then deletes a grammar set; resolves true once it is gone. */
export async function confirmDeleteGrammar(dialog: ReturnType<typeof useDialog>, g: GrammarSet): Promise<boolean> {
  const ok = await dialog.confirm({
    title: `Xoá bài "${g.title || g.grammar}"?`,
    message: "Bài tập và câu trả lời của bạn sẽ bị xoá vĩnh viễn.",
    confirmText: "Xoá bài",
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.deleteGrammarSet(g.id);
    return true;
  } catch (e) {
    await dialog.alert("Không xoá được", e instanceof Error ? e.message : "");
    return false;
  }
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-white/70">
        {label}
      </label>
      {children}
    </div>
  );
}

function LevelPicker({ value, onChange }: { value: string; onChange: (level: string) => void }) {
  return (
    <div className="grid w-full max-w-md grid-cols-6 gap-1 rounded-xl bg-white/5 p-1">
      {LEVELS.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`rounded-lg py-1.5 text-sm font-medium ${value === l ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
