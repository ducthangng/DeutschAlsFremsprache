import { useEffect, useMemo, useState } from "react";
import { api, type TopicDetail, type VocabCandidate } from "../lib/api";
import { Modal } from "./Dialog";
import Spinner from "./Spinner";

const key = (term: string) => term.trim().toLowerCase();

/** Every distinct word of the topic's lines, with the first sentence (and picture) it appears in. */
function wordsOf(topic: TopicDetail): VocabCandidate[] {
  const seen = new Map<string, VocabCandidate>();
  for (const it of topic.items) {
    for (const raw of it.text.split(/\s+/)) {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if ([...w].length < 2 || /^\d+$/.test(w) || seen.has(key(w))) continue;
      seen.set(key(w), { term: w, example: it.text, imageKey: it.imageKey || undefined });
    }
  }
  return [...seen.values()];
}

/**
 * Copy words from a topic (often someone else's) into your Vocabulary Pocket:
 * tick the topic's word list, or pick / search words from its sentences.
 */
export default function AddVocabDialog({ topic, onClose }: { topic: TopicDetail; onClose: () => void }) {
  const [list, setList] = useState<VocabCandidate[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"list" | "words">("list");
  const [picked, setPicked] = useState<Map<string, VocabCandidate>>(new Map());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState("");
  const words = useMemo(() => wordsOf(topic), [topic]);

  useEffect(() => {
    Promise.all([api.topicVocabulary(topic.id), api.listVocab()]).then(
      ([vocab, mine]) => {
        const have = new Set(mine.filter((v) => v.language === topic.language).map((v) => key(v.term)));
        setOwned(have);
        setList(vocab);
        // Pre-select the topic's word list, minus what is already in the pocket.
        setPicked(new Map(vocab.filter((v) => !have.has(key(v.term))).map((v) => [key(v.term), v])));
        if (vocab.length === 0) setTab("words");
      },
      (e) => setError(e.message),
    );
  }, [topic.id, topic.language]);

  function toggle(c: VocabCandidate) {
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(key(c.term))) n.delete(key(c.term));
      else n.set(key(c.term), c);
      return n;
    });
  }

  const q = key(query);
  const shownWords = words.filter((w) => !q || key(w.term).includes(q));
  const customPhrase = q && !words.some((w) => key(w.term) === q) && !(list ?? []).some((v) => key(v.term) === q) ? query.trim() : "";

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await api.bulkAddVocab(topic.language, topic.id, [...picked.values()]);
      setResult({ added: res.added.length, skipped: res.skipped.length });
      setOwned((o) => new Set([...o, ...res.added.map((v) => key(v.term))]));
      setPicked(new Map());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thêm được");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (t: "list" | "words", label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
    >
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Thêm từ vựng vào Pocket" width="max-w-xl">
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {tabBtn("list", `Từ vựng của topic${list ? ` (${list.length})` : ""}`)}
        {tabBtn("words", "Chọn từ trong bài")}
      </div>

      <div className="mt-4 h-80 overflow-y-auto">
        {!list && !error && <Spinner />}

        {list && tab === "list" && (
          <>
            {list.length === 0 && <p className="text-sm text-slate-500">Topic này chưa có danh sách từ vựng. Hãy chọn từ trong bài ở tab bên cạnh.</p>}
            <ul className="-mx-2 space-y-0.5">
              {list.map((v) => {
                const has = owned.has(key(v.term));
                return (
                  <li key={v.term}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-100 ${has ? "opacity-50" : ""}`}>
                      <input type="checkbox" disabled={has} checked={picked.has(key(v.term))} onChange={() => toggle(v)} className="h-4 w-4 accent-indigo-600" />
                      {v.imageUrl && <img src={v.imageUrl} alt="" className="h-8 w-12 rounded object-cover" />}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-slate-900">{v.term}</span> <span className="text-slate-500">· {v.meaning}</span>
                      </span>
                      {has && <span className="text-xs text-emerald-600">✓ đã có</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {list && tab === "words" && (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm từ, hoặc gõ một cụm từ…"
              className="mb-3 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500"
            />
            {customPhrase && (
              <button
                onClick={() => toggle({ term: customPhrase })}
                className="mb-3 block rounded-lg px-3 py-1.5 text-sm text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50"
              >
                {picked.has(key(customPhrase)) ? "✓" : "＋"} Thêm cụm từ “{customPhrase}”
              </button>
            )}
            <div className="flex flex-wrap gap-2">
              {shownWords.map((w) => {
                const on = picked.has(key(w.term));
                const has = owned.has(key(w.term));
                return (
                  <button
                    key={w.term}
                    disabled={has}
                    onClick={() => toggle(w)}
                    title={has ? "Đã có trong Pocket" : w.example}
                    className={`rounded-full px-3 py-1 text-sm transition ${
                      has ? "text-slate-400 line-through ring-1 ring-slate-200" : on ? "bg-indigo-600 text-white" : "text-slate-700 ring-1 ring-slate-300 hover:ring-indigo-300"
                    }`}
                  >
                    {w.term}
                  </button>
                );
              })}
              {shownWords.length === 0 && !customPhrase && <p className="text-sm text-slate-500">Không tìm thấy từ nào.</p>}
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <p className="mt-3 text-sm text-emerald-600">
          ✓ Đã thêm {result.added} từ{result.skipped > 0 && ` · ${result.skipped} từ đã có sẵn`}. Ôn tập trong Vocabulary Pocket.
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-500">
          Đã chọn <b className="text-slate-800">{picked.size}</b> · nghĩa tiếng Việt được dịch tự động
        </span>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Đóng
          </button>
          <button
            onClick={save}
            disabled={busy || picked.size === 0}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? "Đang thêm…" : `＋ Thêm ${picked.size || ""} từ`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
