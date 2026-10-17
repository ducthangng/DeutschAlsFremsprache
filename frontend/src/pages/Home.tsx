import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LanguageBadge, PlaylistCard, Row, TopicCard, topicProgress } from "../components/Cards";
import Cover from "../components/Cover";
import { useDialog } from "../components/Dialog";
import { AddToPlaylistDialog, PlaylistFormDialog } from "../components/PlaylistDialogs";
import Popover from "../components/Popover";
import Spinner from "../components/Spinner";
import { api, type Playlist, type Topic } from "../lib/api";

/** One-line explanation for people who have never used playlists. */
const PLAYLIST_INTRO =
  "Playlist là một lộ trình học gồm nhiều topic xếp theo thứ tự. Theo dõi một playlist để luyện lần lượt từng topic và xem tiến độ của bạn.";

export default function Home() {
  const [mine, setMine] = useState<Topic[] | null>(null);
  const [community, setCommunity] = useState<Topic[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [publicPlaylists, setPublicPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState("");
  const [addTo, setAddTo] = useState<number | null>(null);
  const [newPlaylist, setNewPlaylist] = useState(false);
  const dialog = useDialog();
  const navigate = useNavigate();

  useEffect(() => {
    api.listTopics().then(setMine, (e) => setError(e.message));
    api.publicTopics().then(setCommunity, () => {});
    api.myPlaylists().then(setPlaylists, () => {});
    api.publicPlaylists().then(setPublicPlaylists, () => {});
  }, []);

  const { hero, continuing, others } = useMemo(() => {
    const all = new Map<number, Topic>();
    for (const t of [...(mine ?? []), ...community]) all.set(t.id, t);
    const continuing = [...all.values()]
      .filter((t) => t.lastPracticedAt && topicProgress(t) < 1)
      .sort((a, b) => (b.lastPracticedAt! > a.lastPracticedAt! ? 1 : -1));
    const hero = continuing[0] ?? mine?.[0] ?? community[0];
    return { hero, continuing, others: community.filter((t) => !t.isOwner) };
  }, [mine, community]);

  async function toggleVisibility(t: Topic) {
    const next = t.visibility === "public" ? "private" : "public";
    if (
      next === "public" &&
      !(await dialog.confirm({
        title: `Chia sẻ "${t.title}"?`,
        message: "Mọi người sẽ thấy topic này trong mục Khám phá và luyện được với bản ghi của riêng họ. Chỉ bạn sửa được nội dung.",
        confirmText: "Công khai",
      }))
    )
      return;
    try {
      const u = await api.setVisibility(t.id, next);
      setMine((ts) => ts?.map((x) => (x.id === t.id ? u : x)) ?? null);
    } catch (e) {
      dialog.alert("Không đổi được trạng thái", e instanceof Error ? e.message : "");
    }
  }

  async function remove(t: Topic) {
    const ok = await dialog.confirm({
      title: `Xoá "${t.title}"?`,
      message: "Topic, mọi bản ghi âm và kết quả luyện tập của nó sẽ bị xoá vĩnh viễn.",
      confirmText: "Xoá topic",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteTopic(t.id);
      setMine((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
    } catch (e) {
      dialog.alert("Không xoá được", e instanceof Error ? e.message : "");
    }
  }

  const ownerMenu = (t: Topic) => (
    <Popover label={<span className="rounded-md bg-black/60 px-2 py-0.5 text-white backdrop-blur">⋯</span>} title="Tuỳ chọn" width="w-52">
      {(close) => (
        <div className="-m-2 flex flex-col text-sm">
          {[
            ["＋ Thêm vào playlist", () => setAddTo(t.id)],
            ["✏️ Sửa", () => navigate(`/topics/${t.id}/edit`)],
            [t.visibility === "public" ? "🔒 Chuyển về riêng tư" : "🌐 Công khai", () => toggleVisibility(t)],
            ["🗑 Xoá", () => remove(t)],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              onClick={() => {
                close();
                (fn as () => void)();
              }}
              className="rounded-lg px-3 py-2 text-left hover:bg-slate-100"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;
  if (!mine) return <Spinner className="mx-auto mt-24" />;

  const createCard = "flex aspect-video w-64 shrink-0 snap-start flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 transition hover:border-indigo-300 hover:text-slate-700 sm:w-72";
  // No topic or no playlist of their own yet: show public content first.
  const newcomer = mine.length === 0 || playlists.length === 0;
  const othersPublicPlaylists = publicPlaylists.filter((p) => !p.isOwner && !p.following);
  const english = others.filter((t) => t.language === "en-US");
  const german = others.filter((t) => t.language === "de-DE");
  const exploreLink = (
    <Link to="/public" className="shrink-0 text-sm text-slate-400 hover:text-slate-700">
      Khám phá ›
    </Link>
  );

  const continuingRow = continuing.length > 0 && (
    <Row title="Tiếp tục luyện">
      {continuing.map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </Row>
  );

  const publicPlaylistsRow = othersPublicPlaylists.length > 0 && (
    <Row title="Playlist công khai" subtitle={PLAYLIST_INTRO} action={exploreLink}>
      {othersPublicPlaylists.slice(0, 20).map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
    </Row>
  );

  const englishRow = english.length > 0 && (
    <Row title={<><LanguageBadge language="en-US" /> Topic tiếng Anh công khai</>} action={exploreLink}>
      {english.slice(0, 20).map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </Row>
  );

  const germanRow = german.length > 0 && (
    <Row title={<><LanguageBadge language="de-DE" /> Topic tiếng Đức công khai</>} action={exploreLink}>
      {german.slice(0, 20).map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </Row>
  );

  const myPlaylistsRow = (
    <Row
      title="Playlist của bạn"
      subtitle={playlists.length === 0 ? PLAYLIST_INTRO : undefined}
      action={
        <Link to="/playlists" className="shrink-0 text-sm text-slate-400 hover:text-slate-700">
          Xem tất cả ›
        </Link>
      }
    >
      {playlists.map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
      <button onClick={() => setNewPlaylist(true)} className={createCard}>
        <span className="text-3xl">＋</span>
        <span className="mt-1 text-sm">Playlist mới</span>
      </button>
    </Row>
  );

  const myTopicsRow = (
    <Row title="Topic của tôi">
      <Link to="/topics/new" className={createCard}>
        <span className="text-3xl">＋</span>
        <span className="mt-1 text-sm">Tạo topic</span>
      </Link>
      {mine.map((t) => (
        <TopicCard key={t.id} topic={t} menu={ownerMenu(t)} />
      ))}
    </Row>
  );

  const communityRow = others.length > 0 && (
    <Row title="Mới từ cộng đồng" action={exploreLink}>
      {others.slice(0, 20).map((t) => (
        <TopicCard key={t.id} topic={t} />
      ))}
    </Row>
  );

  return (
    <div className="pb-20">
      {hero ? (
        <Hero topic={hero} continuing={continuing[0]?.id === hero.id} onAddToPlaylist={() => setAddTo(hero.id)} />
      ) : (
        <section className="px-4 pt-20 text-center sm:px-10">
          <h1 className="text-4xl font-bold text-slate-900">Chào mừng bạn 👋</h1>
          <p className="mx-auto mt-3 max-w-lg text-slate-500">Tạo topic đầu tiên: một tình huống bạn muốn nói trôi chảy, như ở nhà ga hay đi khám bệnh. Bạn có thể nhờ AI viết giúp.</p>
          <Link to="/topics/new" className="mt-8 inline-block rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-500">
            ＋ Tạo topic
          </Link>
        </section>
      )}

      {newcomer ? (
        // Nothing of their own yet: lead with what the community shares.
        <>
          {publicPlaylistsRow}
          {englishRow}
          {germanRow}
          {continuingRow}
          {myPlaylistsRow}
          {myTopicsRow}
        </>
      ) : (
        <>
          {continuingRow}
          {myPlaylistsRow}
          {myTopicsRow}
          {communityRow}
          {publicPlaylistsRow}
        </>
      )}

      {addTo !== null && <AddToPlaylistDialog topicId={addTo} open onClose={() => {
        setAddTo(null);
        api.myPlaylists().then(setPlaylists, () => {});
      }} />}
      <PlaylistFormDialog open={newPlaylist} onClose={() => setNewPlaylist(false)} onSaved={(p) => navigate(`/playlists/${p.id}`)} />
    </div>
  );
}

function Hero({ topic, continuing, onAddToPlaylist }: { topic: Topic; continuing: boolean; onAddToPlaylist: () => void }) {
  const pct = topicProgress(topic);
  return (
    <section className="relative">
      <Cover url={topic.coverUrl} title={topic.title} className="h-[52vh] min-h-[340px] w-full">
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d0e12] via-[#0d0e12]/75 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0d0e12] to-transparent" />
        <div className="absolute inset-0 flex items-end px-4 pb-12 sm:px-10">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
              {continuing ? "Tiếp tục luyện" : "Gợi ý cho bạn"} · {topic.kind === "dialogue" ? "Hội thoại" : "Từ vựng"}
            </p>
            <LanguageBadge language={topic.language} className="mt-3" />
            <h1 className="mt-2 text-4xl font-bold leading-tight text-white sm:text-5xl">{topic.title}</h1>
            {topic.description && <p className="mt-3 line-clamp-2 text-white/70">{topic.description}</p>}
            {pct > 0 && (
              <div className="mt-4 flex items-center gap-3 text-sm text-white/60">
                <div className="h-1 w-40 rounded-full bg-white/15">
                  <div className="h-1 rounded-full bg-indigo-500" style={{ width: `${pct * 100}%` }} />
                </div>
                {Math.round(pct * 100)}%
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={`/topics/${topic.id}`} className="rounded-lg bg-white px-6 py-2.5 font-semibold text-black hover:bg-white/85">
                ▶ {continuing ? "Tiếp tục" : "Bắt đầu"}
              </Link>
              <Link to={`/topics/${topic.id}?mode=write`} className="rounded-lg bg-white/15 px-5 py-2.5 font-semibold text-white backdrop-blur hover:bg-white/25">
                ✍️ Nghe – Viết
              </Link>
              <button onClick={onAddToPlaylist} className="rounded-lg bg-white/15 px-4 py-2.5 font-semibold text-white backdrop-blur hover:bg-white/25" title="Thêm vào playlist">
                ＋
              </button>
            </div>
          </div>
        </div>
      </Cover>
    </section>
  );
}
