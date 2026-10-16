import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { topicProgress } from "../components/Cards";
import Cover from "../components/Cover";
import { Modal, useDialog } from "../components/Dialog";
import { AvatarStack } from "../components/Avatar";
import { confirmPublish, PlaylistFormDialog } from "../components/PlaylistDialogs";
import Spinner from "../components/Spinner";
import { api, LANGUAGES, type Participant, type PlaylistDetail as Detail, type Topic } from "../lib/api";

export default function PlaylistDetail() {
  const id = Number(useParams().id);
  const [pl, setPl] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const dialog = useDialog();
  const navigate = useNavigate();

  const [people, setPeople] = useState<Participant[]>([]);
  const reload = () => {
    api.getPlaylist(id).then(setPl, (e) => setError(e.message));
    api.playlistParticipants(id).then(setPeople, () => {});
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;
  if (!pl) return <Spinner className="mx-auto mt-24" />;

  const next = pl.topics.find((t) => topicProgress(t) < 1) ?? pl.topics[0];

  async function follow(on: boolean) {
    try {
      await api.followPlaylist(id, on);
      setPl((p) => p && { ...p, following: on, followerCount: p.followerCount + (on ? 1 : -1) });
    } catch (e) {
      dialog.alert("Không cập nhật được", e instanceof Error ? e.message : "");
    }
  }

  async function remove() {
    if (!(await dialog.confirm({ title: `Xoá playlist "${pl!.name}"?`, message: "Các topic bên trong vẫn được giữ nguyên.", confirmText: "Xoá", danger: true }))) return;
    await api.deletePlaylist(id);
    navigate("/playlists");
  }

  async function move(i: number, dir: -1 | 1) {
    const ts = [...pl!.topics];
    [ts[i], ts[i + dir]] = [ts[i + dir], ts[i]];
    setPl({ ...pl!, topics: ts });
    await api.reorderPlaylist(id, ts.map((t) => t.id)).catch(() => reload());
  }

  async function removeTopic(t: Topic) {
    setPl({ ...pl!, topics: pl!.topics.filter((x) => x.id !== t.id) });
    await api.removeFromPlaylist(id, t.id).catch(() => {});
    reload();
  }

  const p = pl.progress;
  return (
    <div className="pb-20">
      <Cover url={pl.coverUrl} title={pl.name} className="h-[40vh] min-h-[300px] w-full">
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d0e12] via-[#0d0e12]/80 to-[#0d0e12]/30" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0d0e12] to-transparent" />
        <div className="absolute inset-0 flex items-end px-4 pb-10 sm:px-10">
          <div className="max-w-2xl">
            <Link to="/playlists" className="text-sm text-white/50 hover:text-white">
              ← Playlist
            </Link>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
              Playlist{pl.level && ` · ${pl.level}`} · {pl.visibility === "public" ? `🌐 ${pl.followerCount} người theo dõi` : "🔒 Riêng tư"}
              {!pl.isOwner && ` · bởi ${pl.ownerName}`}
            </p>
            <h1 className="mt-2 text-4xl font-bold text-white sm:text-5xl">{pl.name}</h1>
            {pl.description && <p className="mt-3 text-white/70">{pl.description}</p>}
            <div className="mt-4">
              <AvatarStack people={people} label="người tham gia" />
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm text-white/60">
              <div className="h-1.5 w-48 rounded-full bg-white/15">
                <div className={`h-1.5 rounded-full ${p.percent >= 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${p.percent}%` }} />
              </div>
              Tiến độ của bạn: {p.topicsDone}/{p.topicsTotal} topic · {Math.round(p.percent)}%
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {next && (
                <Link to={`/topics/${next.id}`} className="rounded-lg bg-white px-6 py-2.5 font-semibold text-black hover:bg-white/85">
                  ▶ {p.percent > 0 ? "Học tiếp" : "Bắt đầu"}
                </Link>
              )}
              {pl.isOwner ? (
                <>
                  <button onClick={() => setAdding(true)} className="rounded-lg bg-white/15 px-4 py-2.5 font-semibold text-white backdrop-blur hover:bg-white/25">
                    ＋ Thêm topic
                  </button>
                  <button onClick={() => setEditing(true)} className="rounded-lg bg-white/15 px-4 py-2.5 text-white backdrop-blur hover:bg-white/25">
                    ✏️ Sửa
                  </button>
                  <button onClick={remove} className="rounded-lg px-3 py-2.5 text-white/60 hover:bg-white/10 hover:text-white">
                    🗑
                  </button>
                </>
              ) : (
                <button
                  onClick={() => follow(!pl.following)}
                  className={`rounded-lg px-5 py-2.5 font-semibold backdrop-blur ${pl.following ? "bg-white/15 text-white hover:bg-white/25" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
                >
                  {pl.following ? "✓ Đang theo dõi" : "＋ Theo dõi"}
                </button>
              )}
            </div>
          </div>
        </div>
      </Cover>

      <ol className="mt-6 max-w-4xl space-y-2 px-2 sm:px-8">
        {pl.topics.length === 0 && (
          <p className="py-10 text-center text-slate-500">{pl.isOwner ? "Playlist trống. Bấm ＋ Thêm topic để bắt đầu." : "Playlist này chưa có topic nào."}</p>
        )}
        {pl.topics.map((t, i) => {
          const pct = topicProgress(t);
          return (
            <li key={t.id} className="group flex items-center gap-4 rounded-xl p-2 transition hover:bg-surface">
              <span className="w-6 text-right text-lg tabular-nums text-slate-400">{i + 1}</span>
              <Link to={`/topics/${t.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                <Cover url={t.coverUrl} title={t.title} className="aspect-video w-36 shrink-0 rounded-lg">
                  {pct >= 1 && <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 text-xs text-white">✓</span>}
                </Cover>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-slate-900">{t.title}</h3>
                  <p className="truncate text-sm text-slate-400">
                    {LANGUAGES[t.language].flag} {t.kind === "dialogue" ? "Hội thoại" : "Từ vựng"} · {t.itemCount} câu
                    {t.description && ` · ${t.description}`}
                  </p>
                  <div className="mt-2 h-1 w-full max-w-xs rounded-full bg-slate-200">
                    <div className={`h-1 rounded-full ${pct >= 1 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>
              </Link>
              {pl.isOwner && (
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Lên">
                    ↑
                  </button>
                  <button disabled={i === pl.topics.length - 1} onClick={() => move(i, 1)} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Xuống">
                    ↓
                  </button>
                  <button onClick={() => removeTopic(t)} className="rounded px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-500" title="Bỏ khỏi playlist">
                    ✕
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {pl.hiddenTopics > 0 && (
          <p className="px-12 pt-2 text-sm text-slate-400">
            {pl.hiddenTopics} topic riêng tư của {pl.isOwner ? "bạn bị ẩn với người theo dõi" : "người tạo không hiển thị"}.
          </p>
        )}
      </ol>

      <PlaylistFormDialog open={editing} initial={pl} onClose={() => setEditing(false)} onSaved={() => reload()} />
      {adding && <AddTopicsDialog playlistId={id} existing={pl.topics.map((t) => t.id)} onClose={() => (setAdding(false), reload())} />}
    </div>
  );
}

/** Pick topics (your own or public ones) to add to a playlist. */
function AddTopicsDialog({ playlistId, existing, onClose }: { playlistId: number; existing: number[]; onClose: () => void }) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [added, setAdded] = useState(new Set(existing));
  const dialog = useDialog();
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([api.listTopics(), api.publicTopics()]).then(([mine, pub]) => {
      const all = new Map<number, Topic>();
      for (const t of [...mine, ...pub]) all.set(t.id, t);
      setTopics([...all.values()]);
    });
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (topics ?? []).filter((t) => !q || `${t.title} ${t.ownerName}`.toLowerCase().includes(q)), [topics, q]);

  async function add(t: Topic) {
    setAdded((s) => new Set(s).add(t.id));
    try {
      if ((await confirmPublish(dialog, (mp) => api.addToPlaylist(playlistId, t.id, mp))) === null) undo(t);
    } catch (e) {
      undo(t);
      dialog.alert("Không thêm được topic", e instanceof Error ? e.message : "");
    }
  }

  function undo(t: Topic) {
    setAdded((s) => {
      const n = new Set(s);
      n.delete(t.id);
      return n;
    });
  }

  return (
    <Modal open onClose={onClose} title="Thêm topic vào playlist" width="max-w-lg">
      <input
        autoFocus
        className="mb-3 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500"
        placeholder="Tìm topic…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!topics && <Spinner />}
      <ul className="-mx-2 max-h-80 space-y-0.5 overflow-y-auto">
        {shown.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-100">
            <Cover url={t.coverUrl} title={t.title} className="aspect-video w-16 shrink-0 rounded" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{t.title}</p>
              <p className="truncate text-xs text-slate-400">{t.isOwner ? (t.visibility === "public" ? "🌐 của bạn" : "🔒 của bạn") : `bởi ${t.ownerName}`}</p>
            </div>
            {added.has(t.id) ? (
              <span className="px-2 text-sm text-emerald-600">✓</span>
            ) : (
              <button onClick={() => add(t)} className="rounded-lg px-3 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
                Thêm
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
          Xong
        </button>
      </div>
    </Modal>
  );
}
