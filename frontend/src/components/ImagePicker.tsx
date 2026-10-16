import { useRef, useState } from "react";
import { api } from "../lib/api";

/**
 * Choose, drop or paste a picture; it is uploaded right away and reported as
 * a storage key (plus a preview URL).
 */
export default function ImagePicker({
  url,
  onChange,
  variant = "cover",
  label = "Thêm ảnh bìa",
}: {
  url: string;
  onChange: (key: string, url: string) => void;
  variant?: "cover" | "thumb";
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  async function upload(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Hãy chọn một file ảnh");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.uploadImage(file);
      onChange(res.key, res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải ảnh lên được");
    } finally {
      setBusy(false);
    }
  }

  const box =
    variant === "cover"
      ? "aspect-video w-full rounded-xl"
      : "h-12 w-16 shrink-0 rounded-lg";

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files[0]);
        }}
        onPaste={(e) => upload(e.clipboardData.files[0])}
        title={url ? "Đổi ảnh" : label}
        className={`group relative flex cursor-pointer items-center justify-center overflow-hidden ring-1 transition ${box} ${
          drag ? "bg-indigo-100 ring-indigo-300" : url ? "ring-slate-200" : "border-2 border-dashed border-slate-300 ring-transparent hover:border-indigo-300"
        }`}
      >
        {url ? (
          <>
            <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white opacity-0 transition group-hover:opacity-100">
              {busy ? "Đang tải…" : "Đổi ảnh"}
            </span>
          </>
        ) : (
          <span className="px-2 text-center text-xs text-slate-400">{busy ? "Đang tải…" : variant === "cover" ? `🖼 ${label} — bấm, kéo thả hoặc dán ảnh` : "🖼"}</span>
        )}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {url && variant === "cover" && (
        <button type="button" onClick={() => onChange("", "")} className="mt-1 text-xs text-slate-400 hover:text-red-500">
          Bỏ ảnh
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
