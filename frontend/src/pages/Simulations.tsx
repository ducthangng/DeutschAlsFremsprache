import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Spinner from "../components/Spinner";
import { api, LANGUAGES, type Language, type Simulation } from "../lib/api";
import { formatUsd } from "../lib/format";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Start an improvised conversation, and browse past ones. */
export default function Simulations() {
  const [sims, setSims] = useState<Simulation[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [language, setLanguage] = useState<Language>("de-DE");
  const [level, setLevel] = useState("A2");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.health().then((h) => setEnabled(h.simulations), () => setEnabled(false));
    api.simulations().then((s) => {
      setSims(s);
      if (s[0]) {
        setLanguage(s[0].language);
        setLevel(s[0].level);
      }
    }, (e) => setError(e.message));
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const sim = await api.startSimulation(language, level, hint.trim());
      navigate(`/simulations/${sim.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được tình huống");
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-20 pt-10 sm:px-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1e1b4b] via-[#15161f] to-[#0d0e12] p-8 ring-1 ring-white/5 sm:p-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">Mô phỏng</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold text-white sm:text-4xl">Nói tự do trong một tình huống bất ngờ</h1>
        <p className="mt-3 max-w-2xl text-white/60">
          AI tạo một tình huống mới dựa trên những gì bạn đã học, rồi đóng vai người đối thoại. Bạn trả lời bằng giọng nói trong 10 lượt. Mỗi lượt được ghi lại thành chữ, chấm phát
          âm, kiểm tra có hợp lý không, và kèm gợi ý câu nói tự nhiên hơn.
        </p>
        <div className="mt-8 flex flex-wrap items-end gap-3">
          <div className="flex gap-1 rounded-xl bg-white/5 p-1">
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${language === l ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
              >
                {LANGUAGES[l].flag} {LANGUAGES[l].label}
              </button>
            ))}
          </div>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white">
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={300}
            placeholder="Chủ đề bạn muốn (tuỳ chọn), VD: hỏng xe đạp, đi khám răng…"
            className="min-w-64 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <button
            onClick={start}
            disabled={busy || enabled === false}
            className="flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 font-semibold text-black hover:bg-white/85 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner className="h-4 w-4 border-black/20 border-t-black" /> Đang tạo tình huống…
              </>
            ) : (
              "🎲 Tạo tình huống"
            )}
          </button>
        </div>
        {enabled === false && <p className="mt-4 text-sm text-amber-700">Cần cấu hình OPENAI_API_KEY trên máy chủ để dùng mô phỏng.</p>}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </section>

      <h2 className="mb-3 mt-12 text-lg font-semibold text-slate-800">Lịch sử</h2>
      {!sims && !error && <Spinner />}
      {sims?.length === 0 && <p className="text-slate-500">Chưa có mô phỏng nào. Hãy thử tình huống đầu tiên!</p>}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sims?.map((s) => (
          <li key={s.id}>
            <Link to={`/simulations/${s.id}`} className="block rounded-2xl bg-surface p-5 ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  {LANGUAGES[s.language].flag} {s.level} · {new Date(s.createdAt).toLocaleDateString("vi-VN")}
                </span>
                <span className={s.status === "active" ? "text-amber-700" : "text-emerald-600"}>
                  {s.status === "active" ? `Đang dở · ${s.userTurns}/${s.maxRounds}` : "✓ Hoàn thành"}
                </span>
              </div>
              <h3 className="mt-2 font-semibold text-slate-900">{s.scenario.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{s.scenario.goal}</p>
              <p className="mt-3 text-xs text-slate-400">
                {s.summary?.overall !== undefined && <span className="mr-2 font-semibold text-slate-700">Điểm {Math.round(s.summary.overall)}</span>}
                {s.userTurns > 0 && `Phát âm ${Math.round(s.avgPron)} · Logic ${Math.round(s.avgLogic)} · `}≈ {formatUsd(s.costUsd)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
