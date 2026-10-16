import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** A centered popup with a dimmed, blurred backdrop. Esc or a backdrop click closes it. */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className={`animate-dialog-in w-full ${width} rounded-2xl bg-surface p-6 shadow-2xl ring-1 ring-slate-200`}>
        {title && <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

interface DialogApi {
  /** Resolves true when the user confirms. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Informational popup with a single OK button. */
  alert: (title: string, message?: ReactNode) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending = ConfirmOptions & { alertOnly?: boolean; resolve: (ok: boolean) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })), []);
  const alert = useCallback(
    (title: string, message?: ReactNode) =>
      new Promise<void>((resolve) => setPending({ title, message, confirmText: "OK", alertOnly: true, resolve: () => resolve() })),
    [],
  );

  useEffect(() => {
    if (pending) confirmBtn.current?.focus();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      <Modal open={pending !== null} onClose={() => close(false)} title={pending?.title}>
        {pending?.message && <div className="text-sm leading-relaxed text-slate-600">{pending.message}</div>}
        <div className="mt-6 flex justify-end gap-2">
          {!pending?.alertOnly && (
            <button onClick={() => close(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {pending?.cancelText ?? "Huỷ"}
            </button>
          )}
          <button
            ref={confirmBtn}
            onClick={() => close(true)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white ${
              pending?.danger ? "bg-red-500 hover:bg-red-600" : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {pending?.confirmText ?? "Đồng ý"}
          </button>
        </div>
      </Modal>
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside DialogProvider");
  return ctx;
}
