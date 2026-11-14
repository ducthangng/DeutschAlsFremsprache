import { useMemo, useRef, useState } from "react";
import { api, GLOSS, LANGUAGES, type Language, type VocabEntry, type VocabPackage } from "../lib/api";
import PackageSelect from "./PackageSelect";
import { Modal } from "./Dialog";
import Spinner from "./Spinner";

const BULK_MAX = 100; // POST /vocab/bulk
const TRANSLATE_MAX = 300; // POST /translate, texts per call
const TERM_MAX = 200;

interface Row {
  id: number;
  term: string;
  meaning: string;
  example: string;
}

const key = (term: string) => term.trim().toLowerCase();

/**
 * One entry per line. A meaning may follow after a tab (pasted from a spreadsheet),
 * " = ", " - " / " – " or ":" — "die Zeitung = newspaper". A line without a meaning
 * but with commas or semicolons is a list of words: "Haus, Auto, Baum".
 */
export function parseVocabList(text: string): { term: string; meaning: string }[] {
  const out: { term: string; meaning: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim(); // bullets / numbering
    if (!line) continue;
    const m = line.match(/^(.+?)(?:\t+|\s*=\s*|\s+[-–—]\s+|\s*:\s+)(.+)$/);
    if (m) {
      out.push({ term: m[1].trim(), meaning: m[2].trim() });
    } else if (/[,;]/.test(line)) {
      for (const part of line.split(/[,;]/)) if (part.trim()) out.push({ term: part.trim(), meaning: "" });
    } else {
      out.push({ term: line, meaning: "" });
    }
  }
  return out;
}

/** Add many words to the Pocket at once: paste a list, translate every missing meaning in one go, check, save. */
export default function BulkVocabDialog({
  existing,
  onClose,
  onAdded,
  packages,
  onPackageCreated,
  defaultPackage,
}: {
  existing: VocabEntry[];
  onClose: () => void;
  onAdded: (added: VocabEntry[]) => void;
  packages: VocabPackage[];
  onPackageCreated: (p: VocabPackage) => void;
  defaultPackage: number | null;
}) {
  const [language, setLanguage] = useState<Language>("de-DE");
  // The whole batch goes into one package.
  const [packageId, setPackageId] = useState<number | null>(defaultPackage);
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"" | "translate" | "save">("");
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const nextId = useRef(1);

  const owned = useMemo(() => new Set(existing.filter((v) => v.language === language).map((v) => key(v.term))), [existing, language]);

  // Duplicate lines in the list, and words already in the Pocket, are not saved.
  const status = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const k = key(r.term);
      if (!k) return "empty" as const;
      if ([...r.term.trim()].length > TERM_MAX) return "long" as const;
      if (owned.has(k)) return "owned" as const;
      if (seen.has(k)) return "dup" as const;
      seen.add(k);
      return "ok" as const;
    });
  }, [rows, owned]);
  const toSave = rows.filter((_, i) => status[i] === "ok");
  const missingMeaning = rows.filter((r, i) => status[i] === "ok" && !r.meaning.trim()).length;

  function addFromPaste() {
    const parsed = parseVocabList(paste);
    if (parsed.length === 0) return;
    setRows((rs) => [...rs, ...parsed.map((p) => ({ id: nextId.current++, term: p.term, meaning: p.meaning, example: "" }))]);
    setPaste("");
    setResult(null);
    setMsg("");
  }

  function addEmptyRow() {
    setRows((rs) => [...rs, { id: nextId.current++, term: "", meaning: "", example: "" }]);
    window.setTimeout(() => document.getElementById(`bulk-term-${nextId.current - 1}`)?.focus(), 0);
  }

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** Fills every empty meaning with the machine translation (one request per 300 words). */
  async function translateAll() {
    const targets = rows.filter((r, i) => status[i] === "ok" && !r.meaning.trim());
    const texts = [...new Set(targets.map((r) => r.term.trim()))];
    if (texts.length === 0) return;
    setBusy("translate");
    setMsg("");
    try {
      const meanings = new Map<string, string>();
      for (let i = 0; i < texts.length; i += TRANSLATE_MAX) {
        const chunk = texts.slice(i, i + TRANSLATE_MAX);
        const res = await api.translate(language, chunk);
        chunk.forEach((t, j) => meanings.set(t, res.translations[j] ?? ""));
      }
      // Keep anything typed while the request was running.
      setRows((rs) => rs.map((r) => (r.meaning.trim() ? r : { ...r, meaning: meanings.get(r.term.trim()) ?? r.meaning })));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Không dịch được");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (toSave.length === 0) return;
    setBusy("save");
    setMsg("");
    const added: VocabEntry[] = [];
    let skipped = 0;
    try {
      for (let i = 0; i < toSave.length; i += BULK_MAX) {
        const chunk = toSave.slice(i, i + BULK_MAX);
        const res = await api.bulkAddVocab(
          language,
          null,
          chunk.map((r) => ({ term: r.term.trim(), meaning: r.meaning.trim() || undefined, example: r.example.trim() || undefined })),
          packageId,
        );
        added.push(...res.added);
        skipped += res.skipped.length;
      }
      const savedKeys = new Set(toSave.map((r) => key(r.term)));
      setRows((rs) => rs.filter((r) => !savedKeys.has(key(r.term))));
      setResult({ added: added.length, skipped });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Không thêm được");
    } finally {
      if (added.length) onAdded(added);
      setBusy("");
    }
  }

  const input = "w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500";
  const note: Record<(typeof status)[number], string> = {
    ok: "",
    empty: "",
    long: "Quá dài",
    owned: "Đã có trong Pocket",
    dup: "Trùng trong danh sách",
  };

  return (
    <Modal open onClose={onClose} title="Thêm nhiều từ vào Pocket" width="max-w-2xl">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(Object.keys(LANGUAGES) as Language[]).map((l) => (
          <button
            type="button"
            key={l}
            onClick={() => setLanguage(l)}
            className={`flex-1 rounded-lg px-2 py-1.5 font-medium ${language === l ? "bg-surface text-indigo-700 shadow-sm" : "text-slate-500"}`}
          >
            {LANGUAGES[l].flag} {LANGUAGES[l].label}
          </button>
        ))}
      </div>

      <PackageSelect className="mt-3" packages={packages} value={packageId} onChange={setPackageId} onCreated={onPackageCreated} />

      <div className="mt-3">
        <textarea
          autoFocus
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addFromPaste();
            }
          }}
          placeholder={"Dán hoặc gõ danh sách, mỗi dòng một từ:\ndie Zeitung\nder Bahnhof = train station\nHaus, Auto, Baum"}
          className={`${input} h-28 font-mono`}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">Nghĩa (tuỳ chọn) đặt sau dấu “=”, “-” hoặc Tab. Ctrl/⌘ + Enter để thêm.</p>
          <button
            type="button"
            onClick={addFromPaste}
            disabled={!paste.trim()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50 disabled:opacity-40"
          >
            ↓ Đưa vào danh sách
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              <b className="text-slate-800">{toSave.length}</b> từ sẽ được thêm
              {missingMeaning > 0 && <> · {missingMeaning} từ chưa có nghĩa</>}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRows([])} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                Xoá hết
              </button>
              <button
                type="button"
                onClick={translateAll}
                disabled={busy !== "" || missingMeaning === 0}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-100 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-40"
                title={`Dịch sang ${GLOSS[language]} mọi từ chưa có nghĩa`}
              >
                {busy === "translate" ? <Spinner className="h-4 w-4" /> : "🪄"} Dịch tất cả
              </button>
            </div>
          </div>

          <ul className="mt-2 max-h-[45vh] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
            {rows.map((r, i) => {
              const st = status[i];
              const off = st !== "ok" && st !== "empty";
              return (
                <li key={r.id} className={`rounded-lg p-1.5 ring-1 ring-slate-200 ${off ? "opacity-60" : ""}`}>
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                    <span className="hidden w-6 shrink-0 text-right text-xs tabular-nums text-slate-400 sm:block">{i + 1}</span>
                    <input
                      id={`bulk-term-${r.id}`}
                      value={r.term}
                      onChange={(e) => update(r.id, { term: e.target.value })}
                      placeholder="Từ / cụm từ"
                      maxLength={TERM_MAX + 50}
                      className={`${input} font-medium sm:flex-[1.1]`}
                    />
                    <div className="flex min-w-0 items-center gap-1.5 sm:flex-1">
                      <input
                        value={r.meaning}
                        onChange={(e) => update(r.id, { meaning: e.target.value })}
                        placeholder={busy === "translate" && !r.meaning ? "Đang dịch…" : `Nghĩa ${GLOSS[language]}`}
                        className={input}
                      />
                      <button
                        type="button"
                        onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"
                        aria-label={`Bỏ “${r.term}”`}
                        title="Bỏ dòng này"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {note[st] && <p className="mt-1 text-xs text-amber-700 sm:pl-8">{note[st]}</p>}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={addEmptyRow} className="mt-2 text-sm text-slate-500 hover:text-indigo-700">
            ＋ Thêm dòng
          </button>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
      {result && (
        <p className="mt-3 text-sm text-emerald-600">
          ✓ Đã thêm {result.added} từ{packageId !== null && <> vào 📦 {packages.find((p) => p.id === packageId)?.name}</>}
          {result.skipped > 0 && ` · ${result.skipped} từ đã có sẵn`}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-400">Từ chưa có nghĩa khi lưu sẽ được dịch tự động.</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {result ? "Xong" : "Huỷ"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy !== "" || toSave.length === 0}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy === "save" ? "Đang thêm…" : `＋ Thêm ${toSave.length || ""} từ`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
