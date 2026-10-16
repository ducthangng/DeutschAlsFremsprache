import type { Participant } from "../lib/api";

// Raw hex on purpose (the theme remaps named shades).
const COLORS = ["#4f46e5", "#0f766e", "#be123c", "#b45309", "#0369a1", "#7c3aed", "#15803d"];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A round profile picture, or colored initials when there is none. */
export default function Avatar({ name, url, size = 32, className = "" }: { name: string; url?: string; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (url) return <img src={url} alt={name} title={name} style={style} className={`shrink-0 rounded-full object-cover ${className}`} />;
  return (
    <span
      title={name}
      style={{ ...style, background: COLORS[hash(name) % COLORS.length] }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars of the people taking part, e.g. "12 người đã luyện". */
export function AvatarStack({ people, label, max = 7, size = 28 }: { people: Participant[]; label: string; max?: number; size?: number }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  return (
    <div className="flex items-center gap-3" title={people.map((p) => p.name).join(", ")}>
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <Avatar key={p.id} name={p.name} url={p.avatarUrl} size={size} className="ring-2 ring-[#0d0e12]" />
        ))}
        {people.length > max && (
          <span
            style={{ width: size, height: size }}
            className="inline-flex items-center justify-center rounded-full bg-[#262a33] text-[11px] font-semibold text-white/80 ring-2 ring-[#0d0e12]"
          >
            +{people.length - max}
          </span>
        )}
      </div>
      <span className="text-sm text-slate-400">
        {people.length} {label}
      </span>
    </div>
  );
}
