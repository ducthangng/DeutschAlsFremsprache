import { useEffect, useMemo, useRef, useState } from "react";
import { api, LANGUAGES, type VocabEntry, type VocabPackage } from "../lib/api";
import { useDialog } from "./Dialog";
import PackageSelect, { lastPackage } from "./PackageSelect";

const STATE_LABEL: Record<VocabEntry["state"], string> = { new: "Mới", learning: "Đang học", young: "Đang nhớ", mature: "Đã thuộc" };
const MAX_RANGE = 5000;

/**
 * "120-150, 160 171; 180" → the IDs it names. Unreadable parts are returned
 * separately so the learner can see what was ignored.
 */
export function parseIds(text: string): { ids: number[]; bad: string[] } {
  const ids = new Set<number>();
  const bad: string[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const range = part.match(/^#?(\d+)\s*[-–]\s*#?(\d+)$/);
    const single = part.match(/^#?(\d+)$/);
    if (range) {
      let [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b) [a, b] = [b, a];
      if (b - a > MAX_RANGE) {
        bad.push(part);
        continue;
      }
      for (let i = a; i <= b; i++) ids.add(i);
    } else if (single) {
      ids.add(Number(single[1]));
    } else {
      bad.push(part);
    }
  }
  return { ids: [...ids], bad };
}

/**
 * The words as a table with checkboxes (Shift-click selects a range), quick
 * selection by ID, and filing the selected words into a package.
 */
export default function VocabTable({
  entries,
  scope,
  packages,
  onPackageCreated,
  setEntries,
  listen,
  onEdit,
}: {
  /** The rows shown (after search / language filters). */
  entries: VocabEntry[];
  /** Every word the ID box may select from (the current Pocket view). */
  scope: VocabEntry[];
  packages: VocabPackage[];
  onPackageCreated: (p: VocabPackage) => void;
  setEntries: (fn: (es: VocabEntry[] | null) => VocabEntry[] | null) => void;
  listen: (v: VocabEntry) => void;
  onEdit: (v: VocabEntry) => void;
}) {
  const dialog = useDialog();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [idText, setIdText] = useState("");
  const [idNote, setIdNote] = useState("");
  const [asc, setAsc] = useState(true);
  const [target, setTarget] = useState<number | null>(() => lastPackage(packages));
  const [moving, setMoving] = useState(false);
  const lastClicked = useRef<number | null>(null);
  const headerBox = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => [...entries].sort((a, b) => (asc ? a.id - b.id : b.id - a.id)), [entries, asc]);
  const packageName = useMemo(() => new Map(packages.map((p) => [p.id, p.name])), [packages]);

  // Forget selections of words that no longer exist (deleted elsewhere).
  useEffect(() => {
    const ids = new Set(scope.map((v) => v.id));
    setSelected((s) => {
      const kept = [...s].filter((id) => ids.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [scope]);

  const shownSelected = rows.filter((v) => selected.has(v.id)).length;
  const allShown = rows.length > 0 && shownSelected === rows.length;
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = shownSelected > 0 && !allShown;
  }, [shownSelected, allShown]);

  function setMany(ids: number[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }

  function clickRow(index: number, shift: boolean) {
    const v = rows[index];
    const on = !selected.has(v.id);
    if (shift && lastClicked.current !== null && lastClicked.current < rows.length) {
      const [a, b] = [Math.min(lastClicked.current, index), Math.max(lastClicked.current, index)];
      setMany(
        rows.slice(a, b + 1).map((r) => r.id),
        on,
      );
    } else {
      setMany([v.id], on);
    }
    lastClicked.current = index;
  }

  function selectByIds(on: boolean) {
    const { ids, bad } = parseIds(idText);
    if (ids.length === 0 && bad.length === 0) return;
    const known = new Set(scope.map((v) => v.id));
    const hit = ids.filter((id) => known.has(id));
    const missing = ids.filter((id) => !known.has(id));
    setMany(hit, on);
    const hidden = hit.filter((id) => !rows.some((r) => r.id === id)).length;
    const parts = [`${on ? "Đã chọn" : "Đã bỏ chọn"} ${hit.length} từ`];
    if (hidden) parts.push(`${hidden} từ đang bị ẩn bởi bộ lọc`);
    if (missing.length) parts.push(`không có ID ${compactIds(missing)}`);
    if (bad.length) parts.push(`không hiểu: ${bad.join(" ")}`);
    setIdNote(parts.join(" · "));
  }

  async function move() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setMoving(true);
    try {
      await api.moveVocab(ids, target);
      const set = new Set(ids);
      setEntries((es) => es?.map((v) => (set.has(v.id) ? { ...v, packageId: target } : v)) ?? null);
      setSelected(new Set());
      setIdNote(`✓ Đã chuyển ${ids.length} từ ${target === null ? "ra khỏi package" : `vào 📦 ${packageName.get(target) ?? ""}`}`);
    } catch (e) {
      dialog.alert("Không chuyển được", e instanceof Error ? e.message : "");
    } finally {
      setMoving(false);
    }
  }

  const field = "rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500";
  const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";

  return (
    <div className="mt-4">
      {/* Quick selection by ID */}
      <div className="rounded-xl bg-surface p-3 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="id-select" className="text-sm text-slate-500">
            Chọn theo ID
          </label>
          <input
            id="id-select"
            value={idText}
            onChange={(e) => setIdText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && selectByIds(true)}
            placeholder="VD: 120-150, 160, 171"
            inputMode="numeric"
            className={`${field} min-w-0 flex-1 font-mono`}
          />
          <button onClick={() => selectByIds(true)} disabled={!idText.trim()} className="rounded-lg bg-indigo-100 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-40">
            ☑ Chọn
          </button>
          <button onClick={() => selectByIds(false)} disabled={!idText.trim()} className="rounded-lg px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-40">
            Bỏ chọn
          </button>
        </div>
        {idNote && <p className="mt-2 text-xs text-slate-500">{idNote}</p>}
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-slate-100/60">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  ref={headerBox}
                  type="checkbox"
                  checked={allShown}
                  onChange={() => setMany(rows.map((v) => v.id), !allShown)}
                  className="h-4 w-4 accent-indigo-600"
                  aria-label="Chọn tất cả các từ đang hiện"
                  title="Chọn / bỏ chọn tất cả các từ đang hiện"
                />
              </th>
              <th className={`${th} w-20`}>
                <button onClick={() => setAsc((a) => !a)} className="uppercase hover:text-slate-700" title="Đổi thứ tự">
                  ID {asc ? "↑" : "↓"}
                </button>
              </th>
              <th className={th}>Từ</th>
              <th className={th}>Nghĩa</th>
              <th className={th}>Package</th>
              <th className={th}>Mức độ</th>
              <th className="w-14 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => {
              const on = selected.has(v.id);
              const due = new Date(v.dueAt).getTime() <= Date.now();
              return (
                <tr
                  key={v.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a, input")) return;
                    clickRow(i, e.shiftKey);
                  }}
                  className={`cursor-pointer border-t border-slate-100 ${on ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {}}
                      onClick={(e) => clickRow(i, e.shiftKey)}
                      className="h-4 w-4 accent-indigo-600"
                      aria-label={`Chọn “${v.term}” (ID ${v.id})`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-slate-500">{v.id}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => listen(v)} className="text-left font-medium text-slate-900 hover:text-indigo-700" title="Nghe">
                      <span className="mr-1 text-xs">{LANGUAGES[v.language].flag}</span>
                      {v.term}
                    </button>
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-slate-500" title={v.meaning}>
                    {v.meaning}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {v.packageId !== null ? `📦 ${packageName.get(v.packageId) ?? "?"}` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                    {STATE_LABEL[v.state]}
                    {due && <span className="ml-1.5 text-amber-700">· đến hạn</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onEdit(v)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      Sửa
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Không có từ nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">Mẹo: giữ Shift khi bấm để chọn cả một đoạn liên tiếp.</p>

      {/* Action bar for the selection */}
      {selected.size > 0 && (
        <div className="sticky bottom-3 z-10 mt-3 rounded-xl bg-surface p-3 shadow-xl ring-1 ring-indigo-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">
              Đã chọn <b className="text-slate-900">{selected.size}</b> từ
            </span>
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
              Bỏ chọn
            </button>
            <PackageSelect className="min-w-0 flex-1" packages={packages} value={target} onChange={setTarget} onCreated={onPackageCreated} />
            <button
              onClick={move}
              disabled={moving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {moving ? "Đang chuyển…" : target === null ? `Bỏ ${selected.size} từ khỏi package` : `Chuyển ${selected.size} từ vào package`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** [3,4,5,9] → "3-5, 9" (at most a few groups, for messages). */
function compactIds(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  const groups: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    groups.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return groups.length > 5 ? `${groups.slice(0, 5).join(", ")}…` : groups.join(", ");
}
