import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { type Language, type Playlist, type Topic } from "../lib/api";
import Cover from "./Cover";

/** Viewer progress of a topic, 0..1: the better of shadowing and listen-write. */
export function topicProgress(t: Topic) {
  if (!t.itemCount) return 0;
  return Math.max(t.passedCount, t.dictationPassedCount) / t.itemCount;
}

/*
 * Language badge: German = gold (flag colors), English = blue. It carries the
 * name in words too, because Windows shows flag emoji only as letters ("DE").
 * Raw hex on purpose: the theme remaps named shades.
 */
const LANG_BADGE: Record<Language, { label: string; flag: string; cls: string }> = {
  "de-DE": { label: "Đức", flag: "🇩🇪", cls: "bg-[#ffce00] text-black" },
  "en-US": { label: "Anh", flag: "🇺🇸", cls: "bg-[#2f7cf6] text-white" },
};

export function LanguageBadge({ language, size = "md", className = "" }: { language: Language; size?: "sm" | "md"; className?: string }) {
  const b = LANG_BADGE[language];
  return (
    <span
      title={language === "de-DE" ? "Tiếng Đức" : "Tiếng Anh"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md font-bold uppercase tracking-wide shadow-sm ${b.cls} ${
        size === "sm" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"
      } ${className}`}
    >
      <span className="text-[1.1em] leading-none">{b.flag}</span>
      {b.label}
    </span>
  );
}

/** A horizontally scrolling row of cards with a heading, Netflix style. */
export function Row({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className="group/row mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4 px-4 sm:px-10">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="mt-0.5 max-w-2xl text-sm text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="relative">
        <div ref={scroller} className="no-scrollbar flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-6 pt-4 sm:scroll-px-10 sm:px-10">
          {children}
        </div>
        <button
          onClick={() => scroll(-1)}
          aria-label="Cuộn trái"
          className="absolute inset-y-1 left-0 hidden w-10 bg-gradient-to-r from-[#0d0e12] to-transparent text-2xl text-white/70 opacity-0 transition group-hover/row:opacity-100 sm:block"
        >
          ‹
        </button>
        <button
          onClick={() => scroll(1)}
          aria-label="Cuộn phải"
          className="absolute inset-y-1 right-0 hidden w-10 bg-gradient-to-l from-[#0d0e12] to-transparent text-2xl text-white/70 opacity-0 transition group-hover/row:opacity-100 sm:block"
        >
          ›
        </button>
      </div>
    </section>
  );
}

/** 16:9 poster card for a topic. On hover it lifts and reveals details. `menu` renders on hover (owner actions). */
export function TopicCard({ topic, menu, wide }: { topic: Topic; menu?: ReactNode; wide?: boolean }) {
  const pct = topicProgress(topic);
  const best = Math.max(topic.passedCount, topic.dictationPassedCount);
  return (
    <div className={`group relative shrink-0 snap-start ${wide ? "w-full" : "w-64 sm:w-72"}`}>
      <Link
        to={`/topics/${topic.id}`}
        className="block rounded-xl transition duration-300 ease-out will-change-transform group-hover:-translate-y-1.5 group-hover:scale-[1.04] focus-visible:-translate-y-1.5 motion-reduce:transform-none"
      >
        <Cover
          url={topic.coverUrl}
          title={topic.title}
          className="aspect-video rounded-xl ring-1 ring-white/5 transition duration-300 group-hover:shadow-2xl group-hover:shadow-black/70 group-hover:ring-indigo-400/60"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent transition-colors duration-300 group-hover:from-black/95 group-hover:via-black/50" />
          {/* play button appears on hover */}
          <span className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 scale-75 items-center justify-center rounded-full bg-white text-lg text-black opacity-0 shadow-lg transition duration-300 group-hover:scale-100 group-hover:opacity-100">
            ▶
          </span>
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="text-[11px] uppercase tracking-wider text-white/50">
              {topic.kind === "dialogue" ? "Hội thoại" : "Từ vựng"} · {topic.itemCount} câu
            </p>
            <h3 className="line-clamp-2 pr-12 font-semibold leading-snug text-white">{topic.title}</h3>
            {/* details slide in on hover */}
            <div className="grid grid-rows-[0fr] transition-all duration-300 group-hover:grid-rows-[1fr]">
              <div className="overflow-hidden">
                {topic.description && <p className="mt-1 line-clamp-2 text-xs text-white/70">{topic.description}</p>}
                <p className="mt-1 text-[11px] text-white/50">
                  {best > 0 ? `${Math.round(pct * 100)}% · ${best}/${topic.itemCount} câu đạt` : "Chưa luyện"}
                  {topic.completions > 0 && ` · ✓ ${topic.completions} lượt hoàn thành`}
                </p>
              </div>
            </div>
          </div>
          {pct > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div className={`h-1 ${pct >= 1 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct * 100}%` }} />
            </div>
          )}
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <LanguageBadge language={topic.language} />
            {topic.visibility === "public" && topic.isOwner && (
              <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/70 backdrop-blur" title="Công khai">
                🌐
              </span>
            )}
          </div>
        </Cover>
      </Link>
      {menu && <div className="absolute right-2 top-2 z-10 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">{menu}</div>}
      {!topic.isOwner && <p className="mt-1.5 truncate px-1 text-xs text-slate-400">bởi {topic.ownerName}</p>}
    </div>
  );
}

/**
 * A playlist looks like a stack of cards (two layers behind the cover) so it
 * reads differently from a single topic; the stack fans out on hover.
 */
export function PlaylistCard({ playlist, wide }: { playlist: Playlist; wide?: boolean }) {
  const p = playlist.progress;
  return (
    <Link to={`/playlists/${playlist.id}`} className={`group block shrink-0 snap-start pt-4 ${wide ? "w-full" : "w-64 sm:w-72"}`}>
      <div className="relative">
        {/* back layers (raw hex: the theme remaps named shades) */}
        <div className="absolute inset-x-6 -top-4 h-full rounded-xl bg-[#1b1d24] ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:rotate-[-2deg] motion-reduce:transform-none" />
        <div className="absolute inset-x-3 -top-2 h-full rounded-xl bg-[#262a33] ring-1 ring-white/10 transition duration-300 group-hover:-translate-y-0.5 group-hover:rotate-[1.5deg] motion-reduce:transform-none" />
        <Cover
          url={playlist.coverUrl}
          title={playlist.name}
          className="aspect-video rounded-xl shadow-lg shadow-black/40 ring-1 ring-white/10 transition duration-300 group-hover:-translate-y-1 group-hover:ring-indigo-400/60 motion-reduce:transform-none"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <span className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            ▤ {playlist.topicCount} topic
          </span>
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="text-[11px] uppercase tracking-wider text-white/50">Playlist{playlist.level && ` · ${playlist.level}`}</p>
            <h3 className="line-clamp-2 font-semibold leading-snug text-white">{playlist.name}</h3>
          </div>
          {p.topicsTotal > 0 && p.percent > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div className={`h-1 ${p.percent >= 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${p.percent}%` }} />
            </div>
          )}
        </Cover>
      </div>
      <p className="mt-1.5 truncate px-1 text-xs text-slate-400">
        {playlist.isOwner ? (playlist.visibility === "public" ? `🌐 Công khai · ${playlist.followerCount} người theo dõi` : "🔒 Riêng tư") : `bởi ${playlist.ownerName}`}
        {p.topicsTotal > 0 && ` · ${p.topicsDone}/${p.topicsTotal} xong`}
      </p>
    </Link>
  );
}
