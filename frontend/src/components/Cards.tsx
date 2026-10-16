import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LANGUAGES, type Playlist, type Topic } from "../lib/api";
import Cover from "./Cover";

/** Viewer progress of a topic, 0..1: the better of shadowing and listen-write. */
export function topicProgress(t: Topic) {
  if (!t.itemCount) return 0;
  return Math.max(t.passedCount, t.dictationPassedCount) / t.itemCount;
}

/** A horizontally scrolling row of cards with a heading, Netflix style. */
export function Row({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section className="group/row mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4 px-4 sm:px-10">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {action}
      </div>
      <div className="relative">
        <div ref={scroller} className="no-scrollbar flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-6 pt-1 sm:scroll-px-10 sm:px-10">
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

/** 16:9 poster card for a topic. `menu` renders on hover (owner actions). */
export function TopicCard({ topic, menu, wide }: { topic: Topic; menu?: ReactNode; wide?: boolean }) {
  const pct = topicProgress(topic);
  return (
    <div className={`group relative shrink-0 snap-start ${wide ? "w-full" : "w-64 sm:w-72"}`}>
      <Link to={`/topics/${topic.id}`} className="block">
        <Cover
          url={topic.coverUrl}
          title={topic.title}
          className="aspect-video rounded-xl ring-1 ring-white/5 transition duration-300 group-hover:scale-[1.03] group-hover:ring-white/20 group-hover:shadow-2xl group-hover:shadow-black/60"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="text-[11px] uppercase tracking-wider text-white/50">
              {LANGUAGES[topic.language].flag} {topic.kind === "dialogue" ? "Hội thoại" : "Từ vựng"} · {topic.itemCount} câu
            </p>
            <h3 className="line-clamp-2 font-semibold leading-snug text-white">{topic.title}</h3>
          </div>
          {pct > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div className={`h-1 ${pct >= 1 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct * 100}%` }} />
            </div>
          )}
          {topic.visibility === "public" && topic.isOwner && (
            <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/70 backdrop-blur">🌐 Công khai</span>
          )}
        </Cover>
      </Link>
      {menu && <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">{menu}</div>}
      {!topic.isOwner && <p className="mt-1.5 truncate px-1 text-xs text-slate-400">bởi {topic.ownerName}</p>}
    </div>
  );
}

export function PlaylistCard({ playlist, wide }: { playlist: Playlist; wide?: boolean }) {
  const p = playlist.progress;
  return (
    <Link to={`/playlists/${playlist.id}`} className={`group block shrink-0 snap-start ${wide ? "w-full" : "w-64 sm:w-72"}`}>
      <div className="relative">
        {/* stacked-card look */}
        <div className="absolute inset-x-3 -top-1.5 h-3 rounded-t-xl bg-white/5" />
        <Cover url={playlist.coverUrl} title={playlist.name} className="aspect-video rounded-xl ring-1 ring-white/5 transition group-hover:ring-white/20">
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <p className="text-[11px] uppercase tracking-wider text-white/50">
              ▤ Playlist{playlist.level && ` · ${playlist.level}`} · {playlist.topicCount} topic
            </p>
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
