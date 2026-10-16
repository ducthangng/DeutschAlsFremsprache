import { useEffect, useMemo, useState } from "react";
import { PlaylistCard, Row, TopicCard } from "../components/Cards";
import Spinner from "../components/Spinner";
import { api, LANGUAGES, type Language, type Playlist, type Topic } from "../lib/api";

/** "Khám phá": public playlists and topics shared by everyone. */
export default function PublicTopics() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<Language | "">("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.publicTopics().then(setTopics, (e) => setError(e.message));
    api.publicPlaylists().then(setPlaylists, () => {});
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (topics ?? []).filter((t) => (!lang || t.language === lang) && (!q || `${t.title} ${t.description} ${t.ownerName}`.toLowerCase().includes(q))),
    [topics, lang, q],
  );
  const visiblePlaylists = playlists.filter((p) => !q || `${p.name} ${p.description} ${p.ownerName}`.toLowerCase().includes(q));

  return (
    <div className="pb-20">
      <div className="px-4 pt-10 sm:px-10">
        <h1 className="text-3xl font-bold text-slate-900">Khám phá</h1>
        <p className="mt-1 text-slate-500">Playlist và topic do mọi người chia sẻ. Bạn luyện với bản ghi, điểm và tiến độ của riêng mình.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <input
            className="w-full max-w-xs rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500"
            placeholder="Tìm topic, playlist, người chia sẻ…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={lang} onChange={(e) => setLang(e.target.value as Language | "")} className="rounded-lg border border-slate-300 bg-transparent px-3 py-2">
            <option value="">Mọi ngôn ngữ</option>
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGES[l].flag} {LANGUAGES[l].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visiblePlaylists.length > 0 && (
        <Row title="Playlist công khai">
          {visiblePlaylists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} />
          ))}
        </Row>
      )}

      <section className="mt-10 px-4 sm:px-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Topic công khai</h2>
        {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
        {!topics && !error && <Spinner className="mx-auto mt-10" />}
        {topics && visible.length === 0 && <p className="text-slate-500">Chưa có topic công khai nào{q || lang ? " khớp bộ lọc" : ""}.</p>}
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((t) => (
            <TopicCard key={t.id} topic={t} wide />
          ))}
        </div>
      </section>
    </div>
  );
}
