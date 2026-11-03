import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ColumnChart, GoalRing, MasteryBar, StatTile } from "../components/Charts";
import Cover from "../components/Cover";
import { Modal, useDialog } from "../components/Dialog";
import ImagePicker from "../components/ImagePicker";
import { SpeedControl } from "../components/SpeechControls";
import Spinner from "../components/Spinner";
import { api, ApiError, LANGUAGES, type CardState, type Grade, type Language, type VocabEntry, type VocabInput, type VocabStats } from "../lib/api";
import { speak, type Playback } from "../lib/audio";
import { usePrefs } from "../lib/prefs";

const STATE_LABEL: Record<CardState, string> = { new: "Mới", learning: "Đang học", young: "Đang nhớ", mature: "Đã thuộc" };
const GRADES: { grade: Grade; key: keyof VocabEntry["nextIn"]; label: string; cls: string }[] = [
  { grade: 1, key: "again", label: "Quên", cls: "bg-red-100 text-red-700 hover:bg-red-200" },
  { grade: 2, key: "hard", label: "Khó", cls: "bg-amber-100 text-amber-800 hover:bg-amber-200" },
  { grade: 3, key: "good", label: "Nhớ", cls: "bg-indigo-600 text-white hover:bg-indigo-500" },
  { grade: 4, key: "easy", label: "Dễ", cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" },
];

/** "10 phút", "1 ngày", "3 tháng" */
function formatInterval(sec: number) {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} phút`;
  if (sec < 86400) return `${Math.round(sec / 3600)} giờ`;
  const d = sec / 86400;
  if (d < 30) return `${Math.round(d)} ngày`;
  if (d < 365) return `${Math.round(d / 30)} tháng`;
  return `${(d / 365).toFixed(1)} năm`;
}

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};
const weekday = (iso: string, i: number) => (i === 0 ? "Hôm nay" : i === 1 ? "Mai" : ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(iso + "T00:00:00").getDay()]);

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Pocket() {
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [stats, setStats] = useState<VocabStats | null>(null);
  const [tab, setTab] = useState<"overview" | "words">("overview");
  const [review, setReview] = useState<VocabEntry[] | null>(null);
  const [error, setError] = useState("");
  const [canDraw, setCanDraw] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const [editor, setEditor] = useState<VocabEntry | "new" | null>(null); // the add / edit popup
  const playback = useRef<Playback | null>(null);

  const reload = () => {
    api.listVocab().then(setEntries, (e) => setError(e.message));
    api.vocabStats().then(setStats, () => {});
  };
  useEffect(() => {
    reload();
    api.health().then((h) => setCanDraw(h.imageGeneration), () => {});
    return () => playback.current?.stop();
  }, []);

  const listen = (v: { term: string; language: Language }) => {
    playback.current?.stop();
    playback.current = speak(v.term, { lang: v.language, rate: prefs.rate, voiceURI: prefs.voice[v.language] || undefined });
  };

  const due = useMemo(
    () => (entries ?? []).filter((v) => new Date(v.dueAt).getTime() <= Date.now()).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [entries],
  );

  if (review) {
    return (
      <Review
        cards={review}
        listen={listen}
        onGraded={(v) => setEntries((es) => es?.map((x) => (x.id === v.id ? v : x)) ?? null)}
        onExit={() => {
          setReview(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className="px-4 pb-20 pt-10 sm:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Vocabulary Pocket</h1>
          <p className="mt-1 text-slate-500">Từ của bạn, ôn bằng flash card đúng lúc bạn sắp quên.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setEditor("new")} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            ＋ Thêm từ
          </button>
          <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-slate-200">
            {(
              [
                ["overview", "Tổng quan"],
                ["words", `Từ vựng${entries ? ` (${entries.length})` : ""}`],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === t ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {!entries && !error && <Spinner className="mx-auto mt-16" />}

      {entries && tab === "overview" && (
        <Overview
          stats={stats}
          dueCount={due.length}
          total={entries.length}
          goal={prefs.dailyGoal}
          setGoal={(g) => setPrefs({ dailyGoal: g })}
          onReview={() => setReview(due.slice(0, 50))}
          onReviewAll={() => setReview(shuffle(entries).slice(0, 50))}
          onAddWords={() => setEditor("new")}
        />
      )}

      {entries && tab === "words" && (
        <Words
          entries={entries}
          setEntries={setEntries}
          listen={listen}
          canDraw={canDraw}
          rate={prefs.rate}
          setRate={(rate) => setPrefs({ rate })}
          onEdit={setEditor}
          onChanged={() => api.vocabStats().then(setStats, () => {})}
        />
      )}

      {editor && (
        <VocabDialog
          entry={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(v, isNew) => {
            setEntries((es) => (isNew ? [v, ...(es ?? [])] : (es?.map((x) => (x.id === v.id ? v : x)) ?? null)));
            api.vocabStats().then(setStats, () => {});
            if (isNew) setTab("words");
          }}
        />
      )}
    </div>
  );
}

// ---------------- overview / statistics ----------------

function Overview({
  stats,
  dueCount,
  total,
  goal,
  setGoal,
  onReview,
  onReviewAll,
  onAddWords,
}: {
  stats: VocabStats | null;
  dueCount: number;
  total: number;
  goal: number;
  setGoal: (g: number) => void;
  onReview: () => void;
  onReviewAll: () => void;
  onAddWords: () => void;
}) {
  if (total === 0) {
    return (
      <div className="mt-16 text-center">
        <p className="text-5xl">🎒</p>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">Pocket đang trống</h2>
        <p className="mx-auto mt-2 max-w-md text-slate-500">Pocket chỉ chứa những từ bạn tự chọn: thêm từ bằng nút bên dưới, hoặc bôi đen một từ trong lúc luyện topic rồi bấm ＋ Pocket.</p>
        <button onClick={onAddWords} className="mt-6 rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500">
          ＋ Thêm từ
        </button>
      </div>
    );
  }
  if (!stats) return <Spinner className="mx-auto mt-16" />;

  const today = stats.reviewedToday;
  const goalMet = today >= goal;
  const nudge =
    stats.streak > 0 && today === 0
      ? `Ôn ít nhất 1 thẻ hôm nay để giữ chuỗi ${stats.streak} ngày 🔥`
      : goalMet
        ? "Bạn đã đạt mục tiêu hôm nay. Tuyệt vời! 🎉"
        : dueCount > 0
          ? `Còn ${Math.max(0, goal - today)} thẻ nữa để đạt mục tiêu hôm nay.`
          : "Không còn thẻ đến hạn. Hãy quay lại vào ngày mai, hoặc thêm từ mới.";

  return (
    <div className="mt-8 space-y-6">
      {/* Today */}
      <section className="flex flex-wrap items-center gap-6 rounded-3xl bg-surface p-6 ring-1 ring-slate-200 sm:p-8">
        <div className="relative">
          <GoalRing value={today} goal={goal} size={112} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold text-slate-900">{today}</span>
            <span className="text-[11px] text-slate-400">/ {goal} thẻ</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">Hôm nay</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{dueCount > 0 ? `${dueCount} thẻ đến hạn ôn` : "Đã ôn xong hôm nay"}</p>
          <p className="mt-1 text-slate-500">{nudge}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={onReview}
              disabled={dueCount === 0}
              className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              ▶ Ôn tập{dueCount > 0 && ` (${Math.min(dueCount, 50)})`}
            </button>
            <button onClick={onReviewAll} className="rounded-xl px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
              Ôn ngẫu nhiên
            </button>
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-400">
              Mục tiêu/ngày
              <select value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-slate-700">
                {[10, 20, 30, 50, 100].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon="🔥" label="Chuỗi ngày" value={stats.streak} hint={`Kỷ lục: ${stats.bestStreak} ngày`} />
        <StatTile
          icon="🧠"
          label="Tỉ lệ nhớ (30 ngày)"
          value={stats.retention30 === null ? "–" : `${Math.round(stats.retention30)}%`}
          hint="Số câu trả lời Nhớ hoặc Dễ"
        />
        <StatTile icon="🗂" label="Đã thuộc" value={`${stats.states.mature}/${stats.total}`} hint="Nhắc lại cách nhau từ 3 tuần trở lên" />
        <StatTile icon="⏱" label="Thời gian ôn" value={`${Math.round(stats.totalMinutes)} phút`} hint={`${stats.totalReviews} lượt ôn`} />
      </section>

      {/* Mastery */}
      <section className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-600">Mức độ ghi nhớ</h2>
        <MasteryBar parts={(["new", "learning", "young", "mature"] as CardState[]).map((s) => ({ label: STATE_LABEL[s], value: stats.states[s] }))} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
          <h2 className="mb-6 text-sm font-semibold text-slate-600">Số thẻ ôn mỗi ngày · 30 ngày qua</h2>
          <ColumnChart
            ariaLabel="Số thẻ ôn mỗi ngày trong 30 ngày qua"
            labelEvery={7}
            bars={stats.days.map((d) => ({
              key: d.date,
              label: shortDate(d.date),
              value: d.reviews,
              tooltip: (
                <>
                  <b className="font-semibold">{shortDate(d.date)}</b> · {d.reviews} thẻ
                  {d.reviews > 0 && ` · nhớ ${Math.round((d.remembered / d.reviews) * 100)}%`}
                </>
              ),
            }))}
          />
        </section>
        <section className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
          <h2 className="mb-6 text-sm font-semibold text-slate-600">Thẻ đến hạn · 7 ngày tới</h2>
          <ColumnChart
            ariaLabel="Số thẻ đến hạn trong 7 ngày tới"
            bars={stats.forecast.map((d, i) => ({
              key: d.date,
              label: weekday(d.date, i),
              value: d.reviews,
              tooltip: (
                <>
                  <b className="font-semibold">{weekday(d.date, i)}</b> · {d.reviews} thẻ
                </>
              ),
            }))}
          />
        </section>
      </div>
    </div>
  );
}

// ---------------- word list ----------------

const emptyForm = (language: Language): VocabInput => ({ language, term: "", meaning: "", example: "", imageKey: "" });

/** Popup to add a word to the pocket by hand, or edit one. */
function VocabDialog({ entry, onClose, onSaved }: { entry: VocabEntry | null; onClose: () => void; onSaved: (v: VocabEntry, isNew: boolean) => void }) {
  const [form, setForm] = useState<VocabInput>(() =>
    entry ? { language: entry.language, term: entry.term, meaning: entry.meaning, example: entry.example, imageKey: entry.imageKey } : emptyForm("de-DE"),
  );
  const [imageUrl, setImageUrl] = useState(entry?.imageUrl ?? "");
  const [msg, setMsg] = useState("");
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLInputElement>(null);

  async function suggestMeaning() {
    if (!form.term.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api.translate(form.language, [form.term.trim()]);
      setForm((f) => ({ ...f, meaning: res.translations[0] }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Không dịch được");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (entry) {
        onSaved(await api.updateVocab(entry.id, form), false);
        onClose();
        return;
      }
      const v = await api.createVocab(form);
      onSaved(v, true);
      // Stay open so several words can be added in a row.
      setAdded(v.term);
      setForm(emptyForm(form.language));
      setImageUrl("");
      termRef.current?.focus();
    } catch (err) {
      setMsg(err instanceof ApiError && err.status === 409 ? "Từ này đã có trong Pocket." : err instanceof Error ? err.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500";

  return (
    <Modal open onClose={onClose} title={entry ? "Sửa từ" : "Thêm từ vào Pocket"} width="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        {!entry && (
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setForm((f) => ({ ...f, language: l }))}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium ${form.language === l ? "bg-surface text-indigo-700 shadow-sm" : "text-slate-500"}`}
              >
                {LANGUAGES[l].flag} {LANGUAGES[l].label}
              </button>
            ))}
          </div>
        )}
        <input
          ref={termRef}
          autoFocus
          className={input}
          required
          maxLength={200}
          placeholder="Từ / cụm từ, VD: die Verspätung"
          value={form.term}
          onChange={(e) => setForm({ ...form, term: e.target.value })}
        />
        <div className="flex gap-2">
          <input className={input} placeholder="Nghĩa tiếng Việt" value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} />
          <button type="button" onClick={suggestMeaning} disabled={busy || !form.term.trim()} className="shrink-0 rounded-lg px-3 text-sm text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-40">
            🪄 Dịch
          </button>
        </div>
        <textarea className={`${input} h-16 text-sm`} placeholder="Câu ví dụ (tuỳ chọn)" value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} />
        <ImagePicker
          url={imageUrl}
          label="Thêm ảnh minh hoạ"
          onChange={(key, url) => {
            setForm((f) => ({ ...f, imageKey: key }));
            setImageUrl(url);
          }}
        />
        {msg && <p className="text-sm text-red-600">{msg}</p>}
        {added && !msg && <p className="text-sm text-emerald-600">✓ Đã thêm “{added}”. Thêm từ tiếp theo, hoặc đóng.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {added ? "Xong" : "Huỷ"}
          </button>
          <button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {entry ? "Lưu" : "Thêm vào Pocket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Words({
  entries,
  setEntries,
  listen,
  canDraw,
  rate,
  setRate,
  onEdit,
  onChanged,
}: {
  entries: VocabEntry[];
  setEntries: (fn: (es: VocabEntry[] | null) => VocabEntry[] | null) => void;
  listen: (v: VocabEntry) => void;
  canDraw: boolean;
  rate: number;
  setRate: (r: number) => void;
  onEdit: (v: VocabEntry) => void;
  onChanged: () => void;
}) {
  const [drawing, setDrawing] = useState<number | null>(null);
  const [lang, setLang] = useState<Language | "">("");
  const [query, setQuery] = useState("");
  const dialog = useDialog();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((v) => (!lang || v.language === lang) && (!q || v.term.toLowerCase().includes(q) || v.meaning.toLowerCase().includes(q)));
  }, [entries, lang, query]);

  const replace = (v: VocabEntry) => setEntries((es) => es?.map((x) => (x.id === v.id ? v : x)) ?? null);

  async function draw(v: VocabEntry) {
    const ok = await dialog.confirm({
      title: `Tạo ảnh cho "${v.term}"?`,
      message: "AI sẽ vẽ một hình minh hoạ cho từ này (khoảng $0.01 mỗi ảnh, được ghi vào trang Chi phí).",
      confirmText: "✨ Tạo ảnh",
    });
    if (!ok) return;
    setDrawing(v.id);
    try {
      replace((await api.generateVocabImage(v.id)).entry);
    } catch (e) {
      dialog.alert("Không tạo được ảnh", e instanceof Error ? e.message : "");
    } finally {
      setDrawing(null);
    }
  }

  async function remove(v: VocabEntry) {
    if (!(await dialog.confirm({ title: `Xoá "${v.term}"?`, message: "Từ này và lịch ôn của nó sẽ bị xoá.", confirmText: "Xoá", danger: true }))) return;
    await api.deleteVocab(v.id);
    setEntries((es) => es?.filter((x) => x.id !== v.id) ?? null);
    onChanged();
  }

  const input = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500";

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} max-w-xs`} placeholder="Tìm từ hoặc nghĩa…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={lang} onChange={(e) => setLang(e.target.value as Language | "")} className="rounded-lg border border-slate-300 bg-transparent px-3 py-2">
          <option value="">Mọi ngôn ngữ</option>
          {(Object.keys(LANGUAGES) as Language[]).map((l) => (
            <option key={l} value={l}>
              {LANGUAGES[l].flag} {LANGUAGES[l].label}
            </option>
          ))}
        </select>
        <div className="ml-auto text-sm">
          <SpeedControl compact rate={rate} onChange={setRate} />
        </div>
      </div>
      {entries.length === 0 && <p className="mt-6 text-slate-500">Chưa có từ nào. Bấm ＋ Thêm từ để thêm từ đầu tiên.</p>}
      <ul className="mt-4 grid gap-2 xl:grid-cols-2">
          {visible.map((v) => {
            const isDue = new Date(v.dueAt).getTime() <= Date.now();
            return (
              <li key={v.id} className="group flex items-center gap-4 rounded-xl bg-surface p-3 ring-1 ring-slate-200">
                <Cover url={v.imageUrl} title={v.term} className="h-16 w-24 shrink-0 rounded-lg">
                  {drawing === v.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Spinner className="h-5 w-5" />
                    </span>
                  )}
                </Cover>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <button onClick={() => listen(v)} className="text-lg font-semibold text-slate-900 hover:text-indigo-700" title="Nghe">
                      {v.term}
                    </button>
                    <span className="text-slate-500">{v.meaning}</span>
                  </div>
                  {v.example && <p className="truncate text-sm italic text-slate-400">“{v.example}”</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    {LANGUAGES[v.language].flag} {STATE_LABEL[v.state]}
                    {" · "}
                    {isDue ? <span className="text-amber-700">đến hạn ôn</span> : `ôn sau ${formatInterval((new Date(v.dueAt).getTime() - Date.now()) / 1000)}`}
                    {v.reviews > 0 && ` · ${v.reviews} lượt ôn`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  {canDraw && !v.imageUrl && (
                    <button onClick={() => draw(v)} disabled={drawing !== null} className="rounded px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50" title="Tạo ảnh bằng AI">
                      ✨ Ảnh
                    </button>
                  )}
                  <button onClick={() => onEdit(v)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                    Sửa
                  </button>
                  <button onClick={() => remove(v)} className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50">
                    Xoá
                  </button>
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// ---------------- review session ----------------

function Review({
  cards,
  listen,
  onGraded,
  onExit,
}: {
  cards: VocabEntry[];
  listen: (v: VocabEntry) => void;
  onGraded: (v: VocabEntry) => void;
  onExit: () => void;
}) {
  // Cards answered "again" come back at the end of the session.
  const [queue, setQueue] = useState(cards);
  const [done, setDone] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reverse, setReverse] = useState(false); // front shows the meaning
  const [tally, setTally] = useState({ remembered: 0, forgot: 0, ms: 0 });
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const card = queue[0];

  useEffect(() => {
    shownAt.current = Date.now();
    setFlipped(false);
    if (card && !reverse) listen(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, done, reverse]);

  async function grade(g: Grade) {
    if (!card || busy) return;
    setBusy(true);
    const ms = Date.now() - shownAt.current;
    try {
      const updated = await api.reviewVocab(card.id, g, ms);
      onGraded(updated);
      setTally((t) => ({ remembered: t.remembered + (g >= 3 ? 1 : 0), forgot: t.forgot + (g === 1 ? 1 : 0), ms: t.ms + ms }));
      setQueue((q) => (g === 1 ? [...q.slice(1), updated] : q.slice(1)));
      setDone((d) => d + 1);
    } finally {
      setBusy(false);
    }
  }

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      setFlipped((f) => !f);
    } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) as Grade);
    else if (e.key === "Escape") onExit();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!card) {
    const answered = tally.remembered + tally.forgot || 1;
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="text-5xl">🎉</div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Xong lượt ôn!</h1>
        <div className="mt-8 grid grid-cols-3 gap-3">
          <StatTile label="Thẻ" value={done} />
          <StatTile label="Nhớ" value={`${Math.round((tally.remembered / answered) * 100)}%`} />
          <StatTile label="Thời gian" value={`${Math.max(1, Math.round(tally.ms / 60000))}′`} />
        </div>
        <p className="mt-6 text-sm text-slate-400">Thẻ nhớ tốt sẽ quay lại sau vài ngày, rồi vài tuần. Thẻ quên được hỏi lại sau 10 phút.</p>
        <button onClick={onExit} className="mt-8 rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500">
          Xem thống kê
        </button>
      </div>
    );
  }

  const face = "absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-3xl bg-surface p-8 text-center shadow-2xl ring-1 ring-slate-200 [backface-visibility:hidden]";
  const image = card.imageUrl && <img src={card.imageUrl} alt="" className="mb-5 h-40 w-full max-w-xs rounded-2xl object-cover" />;
  const remaining = queue.length;

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center justify-between text-sm">
        <button onClick={onExit} className="text-slate-400 hover:text-slate-800">
          ← Thoát
        </button>
        <span className="text-slate-400">
          Đã ôn {done} · còn {remaining}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-slate-500">
          <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} className="accent-indigo-600" />
          Nghĩa → Từ
        </label>
      </div>
      <div className="mt-2 h-1 rounded-full bg-slate-200">
        <div className="h-1 rounded-full bg-indigo-500 transition-all" style={{ width: `${(done / (done + remaining)) * 100}%` }} />
      </div>

      <div className="mt-8 h-[26rem] [perspective:1200px]">
        <button
          onClick={() => setFlipped((f) => !f)}
          className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
          aria-label="Lật thẻ"
        >
          <div className={face}>
            {image}
            {reverse ? <p className="text-2xl text-slate-700">{card.meaning || "(chưa có nghĩa)"}</p> : <p className="text-4xl font-bold text-slate-900">{card.term}</p>}
            <span className="absolute bottom-4 text-xs text-slate-400">Bấm hoặc Space để lật</span>
          </div>
          <div className={`${face} [transform:rotateY(180deg)]`}>
            {image}
            <p className="text-3xl font-bold text-slate-900">{card.term}</p>
            <p className="mt-2 text-xl text-slate-600">{card.meaning || "(chưa có nghĩa)"}</p>
            {card.example && <p className="mt-3 text-sm italic text-slate-400">“{card.example}”</p>}
          </div>
        </button>
      </div>

      <div className="mt-6">
        {flipped ? (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button key={g.grade} disabled={busy} onClick={() => grade(g.grade)} className={`rounded-xl px-2 py-2.5 text-center font-semibold ${g.cls}`}>
                {g.label}
                <span className="block text-[11px] font-normal opacity-70">
                  {formatInterval(card.nextIn[g.key])} · {g.grade}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex justify-center gap-3">
            <button onClick={() => listen(card)} className="rounded-xl px-4 py-2.5 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
              🔊 Nghe
            </button>
            <button onClick={() => setFlipped(true)} className="rounded-xl bg-indigo-600 px-8 py-2.5 font-semibold text-white hover:bg-indigo-500">
              Lật thẻ
            </button>
          </div>
        )}
      </div>
      {card.topicId && (
        <p className="mt-6 text-center text-xs text-slate-400">
          Từ topic:{" "}
          <Link to={`/topics/${card.topicId}`} className="underline hover:text-slate-700">
            xem ngữ cảnh
          </Link>
        </p>
      )}
    </div>
  );
}
