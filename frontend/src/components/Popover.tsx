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
    // pointerdown: iOS does not send mousedown for taps on non-clickable areas.
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
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
        <div
          // Phones: a full-width sheet under the header, so it never runs off the screen edge.
          className={`z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl bg-surface p-4 text-sm shadow-xl ring-1 ring-slate-200 max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:w-auto sm:absolute sm:mt-2 ${width} ${align === "right" ? "sm:right-0" : "sm:left-0"}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
