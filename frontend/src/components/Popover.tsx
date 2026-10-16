import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that toggles a small floating panel; closes on outside click or Escape. */
export default function Popover({
  label,
  title,
  children,
  align = "right",
  width = "w-72",
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-surface hover:ring-1 hover:ring-slate-200 ${open ? "bg-surface ring-1 ring-slate-200" : ""}`}
      >
        {label}
      </button>
      {open && (
        <div className={`absolute z-30 mt-2 ${width} rounded-xl bg-surface p-4 text-sm shadow-xl ring-1 ring-slate-200 ${align === "right" ? "right-0" : "left-0"}`}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
