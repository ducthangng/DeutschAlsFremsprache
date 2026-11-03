import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDialog } from "../components/Dialog";
import Spinner from "../components/Spinner";
import { api, type GrammarModels, type GrammarSection, type GrammarSections, type GrammarSet } from "../lib/api";
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
  { key: "rearrange", icon: "🔀", label: "Sắp xếp câu", hint: "Gõ lại câu đúng thứ tự vào ô bên dưới" },
  { key: "reading", icon: "📖", label: "Đọc hiểu", hint: "1 bài đọc + câu hỏi trắc nghiệm" },
  { key: "listening", icon: "🎧", label: "Nghe hiểu", hint: "1 bài nghe + trắc nghiệm & điền từ" },
  { key: "writing", icon: "✍️", label: "Viết (dịch Anh → Đức)", hint: "AI chấm từng câu" },
];

const DEFAULT_COUNTS: GrammarSections = { multipleChoice: 10, rearrange: 10, reading: 10, listening: 10, writing: 10 };

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  }, []);

  const sections = Object.fromEntries(SECTIONS.map((x) => [x.key, enabled[x.key] ? counts[x.key] : 0])) as GrammarSections;
  const total = Object.values(sections).reduce((a, b) => a + b, 0);
  const chosen = meta?.models.find((m) => m.id === model);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const g = await api.createGrammarSet({ grammar: grammar.trim(), level, model, sections });
      navigate(`/grammar/${g.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được bài");
      setBusy(false);
    }
  }

  async function remove(g: GrammarSet) {
    if (!(await dialog.confirm({ title: `Xoá bài "${g.title || g.grammar}"?`, message: "Bài tập và câu trả lời của bạn sẽ bị xoá.", confirmText: "Xoá", danger: true }))) return;
    await api.deleteGrammarSet(g.id);
    setSets((s) => s?.filter((x) => x.id !== g.id) ?? null);
  }

  const field = "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-white/30";

  return (
    <div className="px-4 pb-20 pt-10 sm:px-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0c2a43] via-[#15161f] to-[#0d0e12] p-8 ring-1 ring-white/5 sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">Ngữ pháp</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold text-white sm:text-4xl">Bộ bài tập ngữ pháp tiếng Đức, soạn riêng cho bạn</h1>
        <p className="mt-3 max-w-2xl text-white/60">
          Nhập chủ điểm ngữ pháp và trình độ, chọn dạng bài và số câu. AI soạn trắc nghiệm, sắp xếp câu, bài đọc, bài nghe (giọng đọc Microsoft) và bài dịch Anh → Đức.
        </p>

        <div className="mt-8 space-y-5">
          <div>
            <label className="text-sm font-medium text-white/70" htmlFor="grammar">
              Chủ điểm ngữ pháp
            </label>
            <input
              id="grammar"
              value={grammar}
              onChange={(e) => setGrammar(e.target.value)}
              maxLength={200}
              placeholder="VD: Konjunktiv II, Relativsätze mit Präpositionen, Perfekt…"
              className={`${field} mt-1.5 w-full max-w-2xl px-4 placeholder:text-white/30`}
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
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="text-sm font-medium text-white/70">Trình độ</p>
              <div className="mt-1.5 flex gap-1 rounded-xl bg-white/5 p-1">
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLevel(l)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${level === l ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-64 flex-1">
              <label className="text-sm font-medium text-white/70" htmlFor="model">
                Model
              </label>
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)} className={`${field} mt-1.5 block w-full max-w-md`}>
                {meta?.models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#15161f]">
                    {m.label} ({m.id}): {m.note}
                  </option>
                ))}
              </select>
              {chosen && (
                <p className="mt-1 text-xs text-white/40">
                  {chosen.priceEstimated ? "≈ " : ""}
                  {price(chosen.usdPerMInput)} / {price(chosen.usdPerMOutput)} mỗi 1M token vào / ra{chosen.priceEstimated && " (giá ước tính)"}
                </p>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-white/70">Dạng bài và số câu</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {SECTIONS.map((x) => {
                const on = enabled[x.key];
                return (
                  <li key={x.key} className={`flex items-center gap-3 rounded-xl px-4 py-3 ring-1 transition ${on ? "bg-white/10 ring-white/20" : "bg-white/[0.03] ring-white/5"}`}>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setEnabled((s) => ({ ...s, [x.key]: e.target.checked }))}
                        className="h-4 w-4 accent-indigo-500"
                      />
                      <span className="min-w-0">
                        <span className={`block font-medium ${on ? "text-white" : "text-white/50"}`}>
                          {x.icon} {x.label}
                        </span>
                        <span className="block text-xs text-white/40">{x.hint}</span>
                      </span>
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
                      className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-right text-white disabled:opacity-30"
                    />
                  </li>
                );
              })}
            </ul>
            {!meta?.listeningAudio && meta && enabled.listening && (
              <p className="mt-2 text-xs text-amber-500">Máy chủ chưa có AZURE_SPEECH_KEY: bài nghe sẽ do trình duyệt đọc.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={create}
              disabled={busy || !meta?.enabled || grammar.trim().length < 2 || total === 0 || !model}
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
            <span className="text-sm text-white/40">Thường mất 30 giây đến 2 phút, tuỳ model.</span>
          </div>
          {meta && !meta.enabled && <p className="text-sm text-amber-500">Cần cấu hình OPENAI_API_KEY trên máy chủ để tạo bài ngữ pháp.</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </section>

      <h2 className="mb-3 mt-12 text-lg font-semibold text-slate-800">Bài đã tạo</h2>
      {!sets && !error && <Spinner />}
      {sets?.length === 0 && <p className="text-slate-500">Chưa có bài nào. Hãy tạo bộ bài tập đầu tiên!</p>}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sets?.map((g) => (
          <li key={g.id} className="group relative">
            <Link to={`/grammar/${g.id}`} className="block h-full rounded-2xl bg-surface p-5 ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  {g.level} · {new Date(g.createdAt).toLocaleDateString("vi-VN")}
                </span>
                <span className={g.status === "ready" ? "text-emerald-600" : g.status === "failed" ? "text-red-500" : "text-amber-700"}>
                  {g.status === "ready" ? (g.started ? "Đang làm" : "Sẵn sàng") : g.status === "failed" ? "Lỗi" : "Đang tạo…"}
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
              className="absolute right-3 top-9 rounded px-2 py-1 text-xs text-red-500 opacity-0 transition hover:bg-red-50 focus:opacity-100 group-hover:opacity-100"
              title="Xoá"
            >
              Xoá
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
