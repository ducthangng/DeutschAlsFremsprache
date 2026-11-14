import { useEffect, useState } from "react";
import { api, ApiError, byNewest, type VocabPackage } from "../lib/api";

const LAST_KEY = "pocket.lastPackage";
const NEW = "__new";

/** The package last chosen when adding words (null = none), remembered per browser. */
export function lastPackage(packages: VocabPackage[]): number | null {
  try {
    const id = Number(localStorage.getItem(LAST_KEY));
    return packages.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

function rememberPackage(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(LAST_KEY);
    else localStorage.setItem(LAST_KEY, String(id));
  } catch {
    /* storage unavailable */
  }
}

/** Loads the learner's packages; `add` keeps the list current after creating one inline. */
export function usePackages(initial?: VocabPackage[]) {
  const [packages, setPackages] = useState<VocabPackage[] | null>(initial ?? null);
  useEffect(() => {
    if (initial) return;
    api.vocabPackages().then(setPackages, () => setPackages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const add = (p: VocabPackage) => setPackages((ps) => [...(ps ?? []).filter((x) => x.id !== p.id), p].sort(byNewest));
  return [packages, add] as const;
}

/**
 * Dropdown of the learner's packages, with "no package" and an inline
 * "create new package" entry. The choice is remembered for the next add.
 */
export default function PackageSelect({
  packages,
  value,
  onChange,
  onCreated,
  className = "",
}: {
  packages: VocabPackage[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreated: (p: VocabPackage) => void;
  className?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(id: number | null) {
    rememberPackage(id);
    onChange(id);
  }

  async function create() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError("");
    try {
      const p = await api.createVocabPackage(n);
      onCreated(p);
      choose(p.id);
      setCreating(false);
      setName("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Already exists: just pick it.
        const hit = packages.find((p) => p.name.toLowerCase() === n.toLowerCase());
        if (hit) {
          choose(hit.id);
          setCreating(false);
          setName("");
          return;
        }
      }
      setError(e instanceof Error ? e.message : "Không tạo được package");
    } finally {
      setBusy(false);
    }
  }

  const field = "min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500";

  if (creating) {
    return (
      <div className={className}>
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // inside the add-word form: don't submit it
                create();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setCreating(false);
              }
            }}
            placeholder="Tên package mới, VD: A2 Kapitel 3"
            className={`${field} flex-1`}
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Tạo
          </button>
          <button type="button" onClick={() => setCreating(false)} className="shrink-0 rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100">
            Huỷ
          </button>
        </div>
        {error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            Chưa tạo được package: {error}. Từ sẽ không vào package nào cho tới khi tạo được.
          </p>
        )}
      </div>
    );
  }

  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <span className="shrink-0 text-sm text-slate-500">📦 Package</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW) setCreating(true);
          else choose(e.target.value ? Number(e.target.value) : null);
        }}
        className={`${field} flex-1`}
      >
        <option value="">— Không có package —</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={NEW}>＋ Tạo package mới…</option>
      </select>
    </label>
  );
}
