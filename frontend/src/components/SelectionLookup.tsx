import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Language } from "../lib/api";
import { speak, type Playback } from "../lib/audio";

interface Props {
  language: Language;
  rate: number;
  voiceURI?: string;
  topicId?: number;
}

interface Selection {
  text: string;
  sentence: string;
  imageKey: string;
  x: number;
  y: number;
}

/**
 * Highlight (or double-click) words inside any element marked `data-lookup`
 * to get a popup: listen to them, see the Vietnamese meaning, or save them to
 * the Vocabulary Pocket. `data-sentence` on that element is used as the example.
 */
export default function SelectionLookup({ language, rate, voiceURI, topicId }: Props) {
  const [sel, setSel] = useState<Selection | null>(null);
  const [meaning, setMeaning] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const playback = useRef<Playback | null>(null);

  useEffect(() => {
    function capture() {
      const s = window.getSelection();
      const text = s?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!s || !text || s.rangeCount === 0 || text.length > 200) return;
      const host = (s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement)?.closest<HTMLElement>("[data-lookup]");
      if (!host) return;
      const rect = s.getRangeAt(0).getBoundingClientRect();
      setSel({
        text: text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || text, // trim surrounding punctuation
        sentence: host.dataset.sentence ?? "",
        imageKey: host.dataset.image ?? "",
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
      setMeaning(null);
      setStatus("");
    }
    function onUp(e: Event) {
      if (popup.current?.contains(e.target as Node)) return;
      setTimeout(capture, 0); // let the selection settle (e.g. double-click)
    }
    function onDown(e: Event) {
      if (!popup.current?.contains(e.target as Node)) setSel(null);
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    const close = () => setSel(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  useEffect(() => () => playback.current?.stop(), []);

  if (!sel) return null;

  function listen(slow: boolean) {
    playback.current?.stop();
    playback.current = speak(sel!.text, { lang: language, rate: slow ? Math.max(0.5, rate * 0.7) : rate, voiceURI });
  }

  async function lookup(): Promise<string | null> {
    if (meaning !== null) return meaning;
    setBusy(true);
    setStatus("");
    try {
      const res = await api.translate(language, [sel!.text]);
      setMeaning(res.translations[0]);
      return res.translations[0];
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Không dịch được");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const m = (await lookup()) ?? "";
    setBusy(true);
    try {
      // The line's picture (if any) becomes the flashcard's picture.
      await api.createVocab({ language, term: sel!.text, meaning: m, example: sel!.sentence, topicId, imageKey: sel!.imageKey });
      setStatus("✓ Đã lưu vào Vocabulary Pocket");
    } catch (e) {
      setStatus(e instanceof ApiError && e.status === 409 ? "Từ này đã có trong Pocket" : e instanceof Error ? e.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  const left = Math.min(Math.max(sel.x, 170), window.innerWidth - 170);
  const above = sel.y > 180;
  const btn = "rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50";

  return (
    <div
      ref={popup}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection while clicking buttons
      style={{ left, top: above ? sel.y - 10 : sel.y + 34, transform: `translate(-50%, ${above ? "-100%" : "0"})` }}
      className="fixed z-50 w-80 rounded-xl bg-surface p-3 shadow-xl ring-1 ring-slate-200"
      role="dialog"
      aria-label="Tra từ"
    >
      <div className="mb-2 truncate font-semibold text-slate-900">{sel.text}</div>
      <div className="flex flex-wrap gap-1">
        <button className={btn} onClick={() => listen(false)}>
          🔊 Nghe
        </button>
        <button className={btn} onClick={() => listen(true)}>
          🐢 Chậm
        </button>
        <button className={btn} onClick={lookup} disabled={busy}>
          📖 Nghĩa
        </button>
        <button className={`${btn} text-indigo-700`} onClick={save} disabled={busy}>
          ＋ Pocket
        </button>
      </div>
      {busy && <p className="mt-2 text-xs text-slate-400">Đang xử lý…</p>}
      {meaning !== null && <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{meaning || "(không có bản dịch)"}</p>}
      {status && <p className="mt-2 text-xs text-slate-600">{status}</p>}
    </div>
  );
}
