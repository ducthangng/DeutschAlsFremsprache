import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Modal, useDialog } from "../components/Dialog";
import Spinner from "../components/Spinner";
import { api, type GrammarModels, type GrammarSection, type GrammarSections, type GrammarSet, type VocabEntry } from "../lib/api";
import { formatUsd } from "../lib/format";

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
const MAX_WORDS = 80;

const price = (v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(v % 1 ? 2 : 0)}`;

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
  // Vocabulary: a CEFR word list ("" = same as level) or words from the Pocket.
  const [vocabSource, setVocabSource] = useState<"level" | "pocket">("level");
  const [vocabLevel, setVocabLevel] = useState("");
  const [pocket, setPocket] = useState<VocabEntry[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
    api.listVocab().then((v) => {
      const german = v.filter((x) => x.language === "de-DE").sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      setPocket(german);
      setPicked(new Set(german.slice(0, 30).map((x) => x.term)));
    }, () => setPocket([]));
  }, []);

  const sections = Object.fromEntries(SECTIONS.map((x) => [x.key, enabled[x.key] ? counts[x.key] : 0])) as GrammarSections;
  const total = Object.values(sections).reduce((a, b) => a + b, 0);
  const chosen = meta?.models.find((m) => m.id === model);
  const ownWords = vocabSource === "pocket";

  function togglePick(term: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(term)) next.delete(term);
      else if (next.size < MAX_WORDS) next.add(term);
      return next;
    });
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
        ...(ownWords ? { vocabulary: [...picked] } : { vocabLevel: vocabLevel || level }),
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
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sets?.map((g) => (
          <li key={g.id} className="relative">
            <Link to={`/grammar/${g.id}`} className="block h-full rounded-2xl bg-surface p-5 ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <div className="flex items-center gap-2 pr-10 text-xs text-slate-400">
                <span>
                  {g.level} · {new Date(g.createdAt).toLocaleDateString("vi-VN")}
                </span>
                <span className={g.status === "ready" ? "text-emerald-600" : g.status === "failed" ? "text-red-500" : "text-amber-700"}>
                  · {g.status === "ready" ? (g.started ? "Đang làm" : "Sẵn sàng") : g.status === "failed" ? "Lỗi" : "Đang tạo…"}
                </span>
              </div>
              <h3 className="mt-2 pr-8 font-semibold text-slate-900">{g.title || g.grammar}</h3>
              {g.title && g.title !== g.grammar && <p className="text-sm text-slate-500">{g.grammar}</p>}
              <p className="mt-3 text-xs text-slate-400">{sectionSummary(g.sections)}</p>
              <p className="mt-1 text-xs text-slate-400">
                {g.model} · ≈ {formatUsd(g.costUsd)}
              </p>
            </Link>
            <button
              onClick={() => remove(g)}
              className="absolute right-3 top-3 rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-red-50 hover:text-red-500"
              title="Xoá bài"
              aria-label={`Xoá bài ${g.title || g.grammar}`}
            >
              🗑
            </button>
          </li>
        ))}
      </ul>

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
                  ["pocket", "Từ vựng của tôi"],
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
                ) : pocket.length === 0 ? (
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
                      <span>
                        Đã chọn {picked.size}/{Math.min(pocket.length, MAX_WORDS)} từ · AI sẽ đặt câu xoay quanh các từ này
                      </span>
                      <span className="flex gap-3">
                        <button onClick={() => setPicked(new Set(pocket.slice(0, MAX_WORDS).map((x) => x.term)))} className="hover:text-white">
                          Chọn tất cả
                        </button>
                        <button onClick={() => setPicked(new Set())} className="hover:text-white">
                          Bỏ chọn
                        </button>
                      </span>
                    </div>
                    <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                      {pocket.map((v) => {
                        const on = picked.has(v.term);
                        return (
                          <button
                            key={v.id}
                            onClick={() => togglePick(v.term)}
                            title={v.meaning}
                            className={`rounded-full px-3 py-1 text-xs ring-1 ${on ? "bg-indigo-500/90 text-white ring-indigo-400" : "text-white/60 ring-white/15 hover:text-white"}`}
                          >
                            {v.term}
                          </button>
                        );
                      })}
                    </div>
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
              disabled={busy || !meta?.enabled || grammar.trim().length < 2 || total === 0 || !model || (ownWords && picked.size === 0)}
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
