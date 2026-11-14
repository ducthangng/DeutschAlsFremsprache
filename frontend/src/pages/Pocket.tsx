import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ColumnChart, GoalRing, MasteryBar, StatTile } from "../components/Charts";
import BulkVocabDialog, { splitTerms } from "../components/BulkVocabDialog";
import Cover from "../components/Cover";
import { Modal, useDialog } from "../components/Dialog";
import ImagePicker from "../components/ImagePicker";
import VocabTable from "../components/VocabTable";
import PackageSelect, { lastPackage } from "../components/PackageSelect";
import { SpeedControl } from "../components/SpeechControls";
import Spinner from "../components/Spinner";
import { api, ApiError, GLOSS, LANGUAGES, type CardState, type Grade, type Language, type VocabEntry, type VocabInput, type VocabPackage, type VocabStats } from "../lib/api";
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
  const [tabState, setTab] = useState<"overview" | "packages" | "words">("overview");
  // ?package=<id> opens that package's page (so the browser's Back button returns to the list).
  const [params, setParams] = useSearchParams();
  const viewId = Number(params.get("package")) || null;
  const tab = viewId ? "packages" : tabState;
  const openPackage = (id: number) => {
    setTab("packages");
    setParams({ package: String(id) });
  };
  const closePackage = () => setParams({});
  const [review, setReview] = useState<{ cards: VocabEntry[]; label?: string } | null>(null);
  const [error, setError] = useState("");
  const [canDraw, setCanDraw] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const [editor, setEditor] = useState<VocabEntry | "new" | null>(null); // the add / edit popup
  const [bulk, setBulk] = useState(false); // add many words at once
  const [packages, setPackages] = useState<VocabPackage[]>([]);
  const [packagesError, setPackagesError] = useState("");
  // Which words the page shows and reviews: all, one package, or words without one.
  const [pkg, setPkg] = useState<PackageFilter>("all");
  const playback = useRef<Playback | null>(null);
  const dialog = useDialog();

  const reload = () => {
    api.listVocab().then(setEntries, (e) => setError(e.message));
    api.vocabStats().then(setStats, () => {});
    api.vocabPackages().then(
      (ps) => {
        setPackages(ps);
        setPackagesError("");
      },
      (e) => setPackagesError(e instanceof Error ? e.message : "lỗi không rõ"),
    );
  };
  const addPackage = (p: VocabPackage) => setPackages((ps) => [...ps.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)));

  async function renamePackage(p: VocabPackage, name: string) {
    try {
      addPackage(await api.renameVocabPackage(p.id, name));
    } catch (e) {
      dialog.alert("Không đổi tên được", e instanceof Error ? e.message : "");
    }
  }

  async function deletePackage(p: VocabPackage) {
    const ok = await dialog.confirm({
      title: `Xoá package "${p.name}"?`,
      message: "Các từ trong package vẫn được giữ lại trong Pocket (chuyển sang “Chưa phân loại”).",
      confirmText: "Xoá package",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteVocabPackage(p.id);
      setPackages((ps) => ps.filter((x) => x.id !== p.id));
      setEntries((es) => es?.map((v) => (v.packageId === p.id ? { ...v, packageId: null } : v)) ?? null);
      setPkg("all");
      if (viewId === p.id) closePackage();
    } catch (e) {
      dialog.alert("Không xoá được", e instanceof Error ? e.message : "");
    }
  }
  useEffect(() => {
    reload();
    api.health().then((h) => setCanDraw(h.imageGeneration), () => {});
    return () => playback.current?.stop();
  }, []);

  const listen = (v: { term: string; language: Language }) => {
    playback.current?.stop();
    playback.current = speak(v.term, { lang: v.language, rate: prefs.rate, voiceURI: prefs.voice[v.language] || undefined });
  };

  const shown = useMemo(
    () => (entries ?? []).filter((v) => pkg === "all" || (pkg === "none" ? v.packageId === null : v.packageId === pkg)),
    [entries, pkg],
  );
  const due = useMemo(
    () => shown.filter((v) => new Date(v.dueAt).getTime() <= Date.now()).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [shown],
  );
  const currentPackage = typeof pkg === "number" ? packages.find((p) => p.id === pkg) : undefined;
  const viewed = viewId ? packages.find((p) => p.id === viewId) : undefined;
  // New words go into the package being viewed, else the filtered one, else the last one used.
  const defaultPackage = viewed ? viewed.id : typeof pkg === "number" ? pkg : lastPackage(packages);
  const filterLabel = currentPackage ? `📦 ${currentPackage.name}` : pkg === "none" ? "Chưa phân loại" : undefined;

  // Per package: how many words, and how many are due now (for "Ôn theo package").
  const packageRows = useMemo(() => {
    const now = Date.now();
    const row = (key: PackageFilter, name: string): PackageRow => ({ key, name, words: [], due: [] });
    const rows = [...packages.map((p) => row(p.id, `📦 ${p.name}`)), row("none", "Chưa phân loại")];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const v of entries ?? []) {
      const r = byKey.get(v.packageId ?? "none") ?? byKey.get("none")!;
      r.words.push(v);
      if (new Date(v.dueAt).getTime() <= now) r.due.push(v);
    }
    for (const r of rows) r.due.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return rows.filter((r) => r.words.length > 0 || r.key !== "none");
  }, [entries, packages]);

  if (review) {
    return (
      <Review
        label={review.label}
        cards={review.cards}
        listen={listen}
        onGraded={(v) => setEntries((es) => es?.map((x) => (x.id === v.id ? v : x)) ?? null)}
        onDeleted={(id) => setEntries((es) => es?.filter((x) => x.id !== id) ?? null)}
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
          <button
            onClick={() => setBulk(true)}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50"
          >
            ＋ Thêm nhiều từ
          </button>
          <div className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-slate-200">
            {(
              [
                ["overview", "Tổng quan"],
                ["packages", `Package${packages.length ? ` (${packages.length})` : ""}`],
                ["words", `Từ vựng${entries ? ` (${entries.length})` : ""}`],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  if (viewId) closePackage();
                }}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === t ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {entries && tab !== "packages" && (packages.length > 0 || entries.length > 0) && (
        <PackageBar
          packages={packages}
          entries={entries}
          value={pkg}
          onChange={setPkg}
          onRename={renamePackage}
          onDelete={deletePackage}
        />
      )}

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {packagesError && (
        <p className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-red-700">
          Không tải được danh sách package ({packagesError}).
          <button onClick={reload} className="rounded-lg px-3 py-1 text-sm ring-1 ring-red-200 hover:bg-red-100">
            Thử lại
          </button>
        </p>
      )}
      {!entries && !error && <Spinner className="mx-auto mt-16" />}

      {entries && tab === "packages" && !viewId && (
        <PackageGrid rows={packageRows} onOpen={openPackage} onCreated={addPackage} onReview={(r, random) => setReview({ cards: random ? shuffle(r.words).slice(0, 50) : r.due.slice(0, 50), label: r.name })} />
      )}
      {entries && tab === "packages" && viewId && !viewed && (
        <p className="mt-10 text-center text-slate-500">
          Không tìm thấy package này.{" "}
          <button onClick={closePackage} className="text-indigo-700 hover:underline">
            ← Tất cả package
          </button>
        </p>
      )}
      {entries && viewed && (
        <PackageDetail
          pkg={viewed}
          row={packageRows.find((r) => r.key === viewed.id)}
          onBack={closePackage}
          onRename={(name) => renamePackage(viewed, name)}
          onDelete={() => deletePackage(viewed)}
          onAdd={() => setEditor("new")}
          onAddMany={() => setBulk(true)}
          onReview={(cards) => setReview({ cards, label: `📦 ${viewed.name}` })}
        >
          <Words
            entries={entries.filter((v) => v.packageId === viewed.id)}
            setEntries={setEntries}
            listen={listen}
            canDraw={canDraw}
            rate={prefs.rate}
            setRate={(rate) => setPrefs({ rate })}
            onEdit={setEditor}
            onChanged={() => api.vocabStats().then(setStats, () => {})}
            packages={packages}
            onPackageCreated={addPackage}
          />
        </PackageDetail>
      )}

      {entries && tab !== "packages" && entries.length > 0 && shown.length === 0 && (
        <div className="mt-12 text-center text-slate-500">
          <p className="text-4xl">📦</p>
          <p className="mt-3">{currentPackage ? `Package “${currentPackage.name}” chưa có từ nào.` : "Không có từ nào chưa phân loại."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => setEditor("new")} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              ＋ Thêm từ
            </button>
            <button onClick={() => setBulk(true)} className="rounded-xl px-4 py-2 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
              ＋ Thêm nhiều từ
            </button>
          </div>
        </div>
      )}

      {entries && (shown.length > 0 || entries.length === 0) && tab === "overview" && (
        <Overview
          stats={stats}
          dueCount={due.length}
          total={shown.length}
          goal={prefs.dailyGoal}
          setGoal={(g) => setPrefs({ dailyGoal: g })}
          scope={filterLabel}
          onReview={() => setReview({ cards: due.slice(0, 50), label: filterLabel })}
          onReviewAll={() => setReview({ cards: shuffle(shown).slice(0, 50), label: filterLabel })}
          packageRows={pkg === "all" && packages.length > 0 ? packageRows : []}
          onReviewPackage={(r, random) => setReview({ cards: random ? shuffle(r.words).slice(0, 50) : r.due.slice(0, 50), label: r.name })}
          onOpenPackage={(r) => (typeof r.key === "number" ? openPackage(r.key) : (setPkg(r.key), setTab("words")))}
          onAddWords={() => setEditor("new")}
        />
      )}

      {entries && (shown.length > 0 || entries.length === 0) && tab === "words" && (
        <Words
          entries={shown}
          packageName={pkg === "all" ? (id) => packages.find((p) => p.id === id)?.name : undefined}
          setEntries={setEntries}
          listen={listen}
          canDraw={canDraw}
          rate={prefs.rate}
          setRate={(rate) => setPrefs({ rate })}
          onEdit={setEditor}
          onChanged={() => api.vocabStats().then(setStats, () => {})}
          packages={packages}
          onPackageCreated={addPackage}
        />
      )}

      {bulk && (
        <BulkVocabDialog
          existing={entries ?? []}
          packages={packages}
          onPackageCreated={addPackage}
          defaultPackage={defaultPackage}
          onClose={() => setBulk(false)}
          onAdded={(added) => {
            setEntries((es) => [...added, ...(es ?? [])]);
            api.vocabStats().then(setStats, () => {});
            if (!viewId) setTab("words");
          }}
        />
      )}

      {editor && (
        <VocabDialog
          packages={packages}
          onPackageCreated={addPackage}
          defaultPackage={defaultPackage}
          onBulk={() => {
            setEditor(null);
            setBulk(true);
          }}
          entry={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(v, isNew) => {
            setEntries((es) => (isNew ? [v, ...(es ?? [])] : (es?.map((x) => (x.id === v.id ? v : x)) ?? null)));
            api.vocabStats().then(setStats, () => {});
            if (isNew && !viewId) setTab("words");
          }}
        />
      )}
    </div>
  );
}

type PackageFilter = "all" | "none" | number;
/** One package (or the unfiled words) with its words and the ones due now. */
type PackageRow = { key: PackageFilter; name: string; words: VocabEntry[]; due: VocabEntry[] };

/** Package chips: filter the Pocket by package; rename or delete the selected one. */
function PackageBar({
  packages,
  entries,
  value,
  onChange,
  onRename,
  onDelete,
}: {
  packages: VocabPackage[];
  entries: VocabEntry[];
  value: PackageFilter;
  onChange: (v: PackageFilter) => void;
  onRename: (p: VocabPackage, name: string) => Promise<void>;
  onDelete: (p: VocabPackage) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const counts = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const v of entries) m.set(v.packageId, (m.get(v.packageId) ?? 0) + 1);
    return m;
  }, [entries]);
  const current = typeof value === "number" ? packages.find((p) => p.id === value) : undefined;
  useEffect(() => setRenaming(null), [value]);

  const chip = (v: PackageFilter, label: string, n: number) => (
    <button
      key={String(v)}
      onClick={() => onChange(v)}
      className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition ${
        value === v ? "bg-indigo-600 font-medium text-white" : "text-slate-600 ring-1 ring-slate-200 hover:ring-indigo-300"
      }`}
    >
      {label} <span className={value === v ? "text-white/70" : "text-slate-400"}>{n}</span>
    </button>
  );

  return (
    <div className="mt-6">
      <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {chip("all", "Tất cả", entries.length)}
        {packages.map((p) => chip(p.id, `📦 ${p.name}`, counts.get(p.id) ?? 0))}
        {packages.length > 0 && chip("none", "Chưa phân loại", counts.get(null) ?? 0)}
        {packages.length === 0 && (
          <span className="text-xs text-slate-400">Chia từ thành các package: chọn “＋ Tạo package mới” khi thêm từ.</span>
        )}
      </div>
      {current && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {renaming !== null ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (renaming.trim() && renaming.trim() !== current.name) await onRename(current, renaming.trim());
                setRenaming(null);
              }}
            >
              <input
                autoFocus
                value={renaming}
                maxLength={60}
                onChange={(e) => setRenaming(e.target.value)}
                className="rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 outline-none focus:border-indigo-500"
              />
              <button className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-500">Lưu</button>
              <button type="button" onClick={() => setRenaming(null)} className="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100">
                Huỷ
              </button>
            </form>
          ) : (
            <>
              <button onClick={() => setRenaming(current.name)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">
                ✏️ Đổi tên
              </button>
              <button onClick={() => onDelete(current)} className="rounded-lg px-2 py-1 text-red-500 hover:bg-red-50">
                🗑 Xoá package
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A heading that turns into a text field to rename it. */
function EditableName({ name, onSave }: { name: string; onSave: (name: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = draft?.trim() ?? "";
    if (!n || n === name) return setDraft(null);
    setBusy(true);
    await onSave(n);
    setBusy(false);
    setDraft(null);
  }

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 break-words text-2xl font-bold text-slate-900 sm:text-3xl">📦 {name}</h2>
        <button
          onClick={() => setDraft(name)}
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-800"
          title="Đổi tên package"
          aria-label="Đổi tên package"
        >
          ✏️ Đổi tên
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex w-full max-w-lg gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        value={draft}
        maxLength={60}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
        onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-xl font-semibold outline-none focus:border-indigo-500"
      />
      <button disabled={busy || !draft.trim()} className="shrink-0 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
        {busy ? "…" : "Lưu"}
      </button>
      <button type="button" onClick={() => setDraft(null)} className="shrink-0 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100">
        Huỷ
      </button>
    </form>
  );
}

const STATE_ORDER: CardState[] = ["new", "learning", "young", "mature"];
const masteryParts = (words: VocabEntry[]) => STATE_ORDER.map((st) => ({ label: STATE_LABEL[st], value: words.filter((v) => v.state === st).length }));

/** Every package as a card (words, due, mastery), plus creating a new one. */
function PackageGrid({
  rows,
  onOpen,
  onCreated,
  onReview,
}: {
  rows: PackageRow[];
  onOpen: (id: number) => void;
  onCreated: (p: VocabPackage) => void;
  onReview: (r: PackageRow, random: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const p = await api.createVocabPackage(name.trim());
      onCreated(p);
      setName("");
      onOpen(p.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tạo được package");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows
          .filter((r) => typeof r.key === "number")
          .map((r) => (
            <li key={String(r.key)} className="flex flex-col rounded-2xl bg-surface p-5 ring-1 ring-slate-200 transition hover:ring-indigo-300">
              <button onClick={() => onOpen(r.key as number)} className="text-left">
                <span className="block truncate text-lg font-semibold text-slate-900">{r.name}</span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  {r.words.length} từ
                  {" · "}
                  {r.due.length > 0 ? <span className="text-amber-700">{r.due.length} đến hạn</span> : "không có thẻ đến hạn"}
                </span>
              </button>
              <div className="mt-4">{r.words.length > 0 ? <MasteryBar parts={masteryParts(r.words)} /> : <p className="text-sm text-slate-400">Chưa có từ nào.</p>}</div>
              <div className="mt-auto flex gap-2 pt-4">
                <button onClick={() => onOpen(r.key as number)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                  Xem package →
                </button>
                <button
                  onClick={() => onReview(r, false)}
                  disabled={r.due.length === 0}
                  className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-30"
                >
                  ▶ Ôn{r.due.length > 0 && ` ${Math.min(r.due.length, 50)}`}
                </button>
              </div>
            </li>
          ))}
        <li className="rounded-2xl border border-dashed border-slate-300 p-5">
          <form onSubmit={create}>
            <p className="font-semibold text-slate-700">＋ Package mới</p>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên package, VD: A2 Kapitel 3"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            <button disabled={busy || !name.trim()} className="mt-3 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
              Tạo package
            </button>
          </form>
        </li>
      </ul>
      {rows.some((r) => r.key === "none" && r.words.length > 0) && (
        <p className="mt-4 text-sm text-slate-400">
          {rows.find((r) => r.key === "none")!.words.length} từ chưa thuộc package nào. Mở “Sửa” ở một từ để chuyển nó vào package.
        </p>
      )}
    </div>
  );
}

/** One package: its name (editable), numbers, review buttons and its words. */
function PackageDetail({
  pkg,
  row,
  onBack,
  onRename,
  onDelete,
  onAdd,
  onAddMany,
  onReview,
  children,
}: {
  pkg: VocabPackage;
  row?: PackageRow;
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  onAdd: () => void;
  onAddMany: () => void;
  onReview: (cards: VocabEntry[]) => void;
  children: ReactNode;
}) {
  const words = row?.words ?? [];
  const due = row?.due ?? [];
  const mature = words.filter((v) => v.state === "mature").length;
  return (
    <div className="mt-6">
      <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-700">
        ← Tất cả package
      </button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <EditableName key={pkg.id} name={pkg.name} onSave={onRename} />
        <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-sm text-red-500 hover:bg-red-50">
          🗑 Xoá package
        </button>
      </div>

      <section className="mt-5 rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
        <div className="grid grid-cols-3 gap-3 text-center sm:max-w-md sm:text-left">
          <div>
            <p className="text-2xl font-semibold text-slate-900">{words.length}</p>
            <p className="text-xs text-slate-400">từ</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold ${due.length ? "text-amber-700" : "text-slate-900"}`}>{due.length}</p>
            <p className="text-xs text-slate-400">đến hạn ôn</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-slate-900">{mature}</p>
            <p className="text-xs text-slate-400">đã thuộc</p>
          </div>
        </div>
        {words.length > 0 && (
          <div className="mt-4">
            <MasteryBar parts={masteryParts(words)} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => onReview(due.slice(0, 50))}
            disabled={due.length === 0}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            ▶ Ôn tập{due.length > 0 && ` (${Math.min(due.length, 50)})`}
          </button>
          <button
            onClick={() => onReview(shuffle(words).slice(0, 50))}
            disabled={words.length === 0}
            className="rounded-xl px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40"
          >
            🔀 Ôn ngẫu nhiên
          </button>
          <span className="flex-1" />
          <button onClick={onAdd} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
            ＋ Thêm từ
          </button>
          <button onClick={onAddMany} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
            ＋ Thêm nhiều từ
          </button>
        </div>
      </section>

      {words.length === 0 ? <p className="mt-8 text-center text-slate-500">Package này chưa có từ nào. Thêm từ bằng các nút ở trên.</p> : children}
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
  scope,
  packageRows,
  onReviewPackage,
  onOpenPackage,
}: {
  /** The package being shown, when the Pocket is filtered. */
  scope?: string;
  packageRows: PackageRow[];
  onReviewPackage: (r: PackageRow, random: boolean) => void;
  onOpenPackage: (r: PackageRow) => void;
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
          <p className="text-sm text-slate-500">Hôm nay{scope && <> · <span className="font-medium text-indigo-700">{scope}</span></>}</p>
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

      {/* Review one package at a time */}
      {packageRows.length > 0 && (
        <section className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-600">Ôn theo package</h2>
          <ul className="divide-y divide-slate-100">
            {packageRows.map((r) => {
              const mature = r.words.filter((v) => v.state === "mature").length;
              return (
                <li key={String(r.key)} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <button onClick={() => onOpenPackage(r)} className="min-w-0 flex-1 text-left" title="Xem package này">
                    <span className="block truncate font-medium text-slate-900 hover:text-indigo-700">{r.name}</span>
                    <span className="text-xs text-slate-400">
                      {r.words.length} từ · đã thuộc {mature}
                      {" · "}
                      {r.due.length > 0 ? <span className="text-amber-700">{r.due.length} đến hạn</span> : "không có thẻ đến hạn"}
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => onReviewPackage(r, false)}
                      disabled={r.due.length === 0}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-30"
                    >
                      ▶ Ôn{r.due.length > 0 && ` ${Math.min(r.due.length, 50)}`}
                    </button>
                    <button
                      onClick={() => onReviewPackage(r, true)}
                      disabled={r.words.length === 0}
                      className="rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-30"
                      title="Ôn ngẫu nhiên các từ trong package, kể cả chưa đến hạn"
                    >
                      🔀
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
function VocabDialog({
  entry,
  onClose,
  onSaved,
  onBulk,
  packages,
  onPackageCreated,
  defaultPackage,
}: {
  entry: VocabEntry | null;
  onClose: () => void;
  onSaved: (v: VocabEntry, isNew: boolean) => void;
  onBulk: () => void;
  packages: VocabPackage[];
  onPackageCreated: (p: VocabPackage) => void;
  defaultPackage: number | null;
}) {
  const [form, setForm] = useState<VocabInput>(() =>
    entry
      ? { language: entry.language, term: entry.term, meaning: entry.meaning, example: entry.example, imageKey: entry.imageKey, packageId: entry.packageId }
      : { ...emptyForm("de-DE"), packageId: defaultPackage },
  );
  const [imageUrl, setImageUrl] = useState(entry?.imageUrl ?? "");
  const [msg, setMsg] = useState("");
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLInputElement>(null);

  // New words: several can be typed at once, separated by commas.
  const terms = entry ? [form.term.trim()].filter(Boolean) : splitTerms(form.term);
  const many = terms.length > 1;

  async function suggestMeaning() {
    if (terms.length === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api.translate(form.language, terms);
      // One meaning per word, in the same order, so they pair up when saved.
      setForm((f) => ({ ...f, meaning: res.translations.map((t) => t.replace(/,/g, ";")).join(", ") }));
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
      if (many) {
        // Meanings pair with the words when there are as many of them; otherwise they are translated.
        const meanings = splitTerms(form.meaning);
        if (meanings.length > 0 && meanings.length !== terms.length) {
          setMsg(`Có ${terms.length} từ nhưng ${meanings.length} nghĩa. Hãy nhập nghĩa cho từng từ (cách nhau bằng dấu phẩy), hoặc để trống để dịch tự động.`);
          return;
        }
        const res = await api.bulkAddVocab(
          form.language,
          null,
          terms.map((term, i) => ({ term, meaning: meanings[i] || undefined, example: form.example.trim() || undefined })),
          form.packageId ?? null,
        );
        res.added.forEach((v) => onSaved(v, true));
        setAdded(
          `${res.added.length} từ` + (res.skipped.length ? ` (${res.skipped.length} từ đã có sẵn: ${res.skipped.join(", ")})` : ""),
        );
      } else {
        const v = await api.createVocab({ ...form, term: terms[0] ?? form.term });
        onSaved(v, true);
        setAdded(`“${v.term}”`);
      }
      // Stay open so more words can be added.
      setForm({ ...emptyForm(form.language), packageId: form.packageId }); // the next word goes into the same package
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
          maxLength={entry ? 200 : 4000}
          placeholder={entry ? "Từ / cụm từ" : "Từ / cụm từ, nhiều từ cách nhau bằng dấu phẩy: Haus, Auto, Baum"}
          value={form.term}
          onChange={(e) => setForm({ ...form, term: e.target.value })}
        />
        {many && (
          <p className="-mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
            <span>{terms.length} từ:</span>
            {terms.map((t, i) => (
              <span key={i} className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                {t}
              </span>
            ))}
          </p>
        )}
        <div className="flex gap-2">
          <input className={input} placeholder={many ? `Nghĩa ${GLOSS[form.language]}, theo thứ tự, cách nhau bằng dấu phẩy (hoặc để trống)` : `Nghĩa ${GLOSS[form.language]}`} value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} />
          <button type="button" onClick={suggestMeaning} disabled={busy || !form.term.trim()} className="shrink-0 rounded-lg px-3 text-sm text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-40">
            🪄 Dịch
          </button>
        </div>
        <PackageSelect
          packages={packages}
          value={form.packageId ?? null}
          onChange={(id) => setForm((f) => ({ ...f, packageId: id }))}
          onCreated={onPackageCreated}
        />
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
        {added && !msg && <p className="text-sm text-emerald-600">✓ Đã thêm {added}. Thêm từ tiếp theo, hoặc đóng.</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {!entry && (
            <button type="button" onClick={onBulk} className="mr-auto text-sm text-indigo-700 hover:underline">
              Thêm nhiều từ cùng lúc →
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {added ? "Xong" : "Huỷ"}
          </button>
          <button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {entry ? "Lưu" : many ? `Thêm ${terms.length} từ vào Pocket` : "Thêm vào Pocket"}
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
  packageName,
  packages,
  onPackageCreated,
}: {
  packageName?: (id: number) => string | undefined;
  packages: VocabPackage[];
  onPackageCreated: (p: VocabPackage) => void;
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
  // Cards (with pictures) or a table (IDs, checkboxes, move to a package).
  const [view, setViewState] = useState<"cards" | "table">(() => {
    try {
      return localStorage.getItem("pocket.view") === "table" ? "table" : "cards";
    } catch {
      return "cards";
    }
  });
  const setView = (v: "cards" | "table") => {
    setViewState(v);
    try {
      localStorage.setItem("pocket.view", v);
    } catch {
      /* storage unavailable */
    }
  };

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
        <div className="inline-flex rounded-lg p-0.5 ring-1 ring-slate-300" role="group" aria-label="Kiểu hiển thị">
          {(
            [
              ["cards", "▤ Thẻ"],
              ["table", "▦ Bảng · chọn hàng loạt"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-sm">
          <SpeedControl compact rate={rate} onChange={setRate} />
        </div>
      </div>
      {entries.length === 0 && <p className="mt-6 text-slate-500">Chưa có từ nào. Bấm ＋ Thêm từ để thêm từ đầu tiên.</p>}
      {view === "table" && entries.length > 0 && (
        <VocabTable
          entries={visible}
          scope={entries}
          packages={packages}
          onPackageCreated={onPackageCreated}
          setEntries={setEntries}
          listen={listen}
          onEdit={onEdit}
        />
      )}
      {view === "cards" && (
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
                    {packageName && v.packageId !== null && packageName(v.packageId) && <> · 📦 {packageName(v.packageId)}</>}
                  </p>
                </div>
                <div className={`flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100`}>
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
      )}
    </section>
  );
}

// ---------------- review session ----------------

function Review({
  label,
  cards,
  listen,
  onGraded,
  onDeleted,
  onExit,
}: {
  /** What is being reviewed (a package), shown in the header. */
  label?: string;
  cards: VocabEntry[];
  listen: (v: VocabEntry) => void;
  onGraded: (v: VocabEntry) => void;
  onDeleted: (id: number) => void;
  onExit: () => void;
}) {
  const dialog = useDialog();
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

  /** Drop a card the learner no longer wants: from the Pocket and from this session. */
  async function removeCard() {
    if (!card || busy) return;
    const ok = await dialog.confirm({ title: `Xoá thẻ "${card.term}"?`, message: "Thẻ và lịch ôn của nó sẽ bị xoá khỏi Pocket.", confirmText: "Xoá", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteVocab(card.id);
      onDeleted(card.id);
      setQueue((q) => q.filter((x) => x.id !== card.id));
    } catch (e) {
      dialog.alert("Không xoá được thẻ", e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (document.querySelector('[role="dialog"]')) return; // the confirm popup has the keyboard
    if (e.code === "Space") {
      e.preventDefault();
      setFlipped((f) => !f);
    } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) as Grade);
    else if (e.key === "Delete") removeCard();
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
        {label && <p className="mt-1 text-slate-500">{label}</p>}
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
        <span className="min-w-0 truncate px-2 text-center text-slate-400">
          {label && <span className="font-medium text-indigo-700">{label} · </span>}
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
      <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-400">
        {card.topicId && (
          <span>
            Từ topic:{" "}
            <Link to={`/topics/${card.topicId}`} className="underline hover:text-slate-700">
              xem ngữ cảnh
            </Link>
          </span>
        )}
        <button onClick={removeCard} disabled={busy} className="rounded-lg px-2 py-1 hover:bg-red-50 hover:text-red-500 disabled:opacity-40" title="Xoá thẻ (phím Delete)">
          🗑 Xoá thẻ
        </button>
      </div>
    </div>
  );
}
