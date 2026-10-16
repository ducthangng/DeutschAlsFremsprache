import type { ReactNode } from "react";

/**
 * Deterministic, calm gradients for topics without a picture. Raw hex values
 * on purpose: the theme remaps the named light/dark shades.
 */
const GRADIENTS = [
  "from-[#312e81] via-[#16172a] to-[#0d0e12]",
  "from-[#134e4a] via-[#101c1e] to-[#0d0e12]",
  "from-[#881337] via-[#1c1117] to-[#0d0e12]",
  "from-[#78350f] via-[#1c1610] to-[#0d0e12]",
  "from-[#0c4a6e] via-[#0f1820] to-[#0d0e12]",
  "from-[#4c1d95] via-[#17122a] to-[#0d0e12]",
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/**
 * A topic/playlist poster: the picture if there is one, otherwise a gradient
 * with the first letter. Children are drawn on top (titles, badges).
 */
export default function Cover({ url, title, className = "", children }: { url?: string; title: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`relative overflow-hidden bg-[#111318] ${className}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${GRADIENTS[hash(title) % GRADIENTS.length]}`}>
          <span className="absolute -bottom-6 -right-2 select-none text-[7rem] font-black leading-none text-white/[0.06]">
            {title.trim().charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
