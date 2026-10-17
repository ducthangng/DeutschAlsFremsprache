import { useEffect, useState } from "react";
import { micErrorMessage, openMicrophone } from "../lib/audio";

export type MicState = "unknown" | "granted" | "prompt" | "denied" | "unsupported";

/** Tracks the browser's microphone permission and can ask for it. */
export function useMicPermission() {
  const [state, setState] = useState<MicState>("unknown");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    if (!navigator.permissions?.query) {
      setState("prompt"); // cannot tell: offer the button, the browser decides
      return;
    }
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions.query({ name: "microphone" as PermissionName }).then(
      (s) => {
        if (cancelled) return;
        status = s;
        setState(s.state as MicState);
        s.onchange = () => setState(s.state as MicState); // e.g. changed in site settings
      },
      () => !cancelled && setState("prompt"), // "microphone" not queryable in this browser
    );
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  /** Shows the browser's permission prompt. Returns an error message, or "" on success. */
  async function request(): Promise<string> {
    try {
      const stream = await openMicrophone();
      stream.getTracks().forEach((t) => t.stop()); // only asking; recording opens its own stream
      setState("granted");
      return "";
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") setState("denied");
      return micErrorMessage(e);
    }
  }

  return { state, request };
}

/**
 * Explains why the microphone is needed and asks for it before the first
 * recording, or explains how to unblock it. Renders nothing once granted.
 */
export default function MicPermissionBanner({ className = "" }: { className?: string }) {
  const { state, request } = useMicPermission();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (state === "unknown" || state === "granted") return null;

  if (state === "unsupported") {
    return (
      <div className={`rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200 ${className}`}>
        🎤 Trình duyệt này không cho phép ghi âm. Hãy mở trang bằng Chrome, Edge hoặc Safari bản mới, qua địa chỉ <b>https://</b>.
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className={`flex flex-wrap items-center gap-4 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-200 ${className}`}>
        <span className="text-2xl">🔇</span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-red-700">Micro đang bị chặn cho trang này</p>
          <p className="mt-0.5 text-slate-600">
            Bấm biểu tượng <b>🔒</b> (hoặc <b>ⓘ</b>) bên trái thanh địa chỉ → <b>Micro / Microphone</b> → <b>Cho phép</b>, rồi tải lại trang.
          </p>
        </div>
        <button onClick={() => location.reload()} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100">
          Tải lại trang
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-4 rounded-xl bg-indigo-50 px-4 py-3 ring-1 ring-indigo-200 ${className}`}>
      <span className="text-2xl">🎤</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-slate-900">Cho phép dùng micro để luyện nói</p>
        <p className="mt-0.5 text-slate-500">App cần micro để ghi lại giọng bạn và chấm phát âm. Trình duyệt sẽ hỏi bạn một lần.</p>
        {error && <p className="mt-1 text-red-600">{error}</p>}
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(await request());
          setBusy(false);
        }}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {busy ? "Đang chờ trình duyệt…" : "Cho phép micro"}
      </button>
    </div>
  );
}
