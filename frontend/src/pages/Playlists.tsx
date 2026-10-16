import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlaylistCard } from "../components/Cards";
import { PlaylistFormDialog } from "../components/PlaylistDialogs";
import Spinner from "../components/Spinner";
import { api, type Playlist } from "../lib/api";

export default function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.myPlaylists().then(setPlaylists, (e) => setError(e.message));
  }, []);

  const own = playlists?.filter((p) => p.isOwner) ?? [];
  const followed = playlists?.filter((p) => !p.isOwner) ?? [];

  return (
    <div className="px-4 pb-20 pt-10 sm:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Playlist</h1>
          <p className="mt-1 text-slate-500">Gom các topic thành một lộ trình học. Công khai để người khác theo dõi.</p>
        </div>
        <button onClick={() => setCreating(true)} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500">
          ＋ Playlist mới
        </button>
      </div>

      {error && <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {!playlists && !error && <Spinner className="mx-auto mt-16" />}

      {playlists && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold text-slate-800">Của tôi</h2>
          {own.length === 0 ? (
            <p className="text-slate-500">Bạn chưa tạo playlist nào. Mở menu ⋯ trên một topic rồi chọn "Thêm vào playlist", hoặc tạo playlist mới.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {own.map((p) => (
                <PlaylistCard key={p.id} playlist={p} wide />
              ))}
            </div>
          )}
          <h2 className="mb-3 mt-12 text-lg font-semibold text-slate-800">Đang theo dõi</h2>
          {followed.length === 0 ? (
            <p className="text-slate-500">Theo dõi playlist công khai trong mục Khám phá để thấy tiến độ của bạn ở đây.</p>
          ) : (
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {followed.map((p) => (
                <PlaylistCard key={p.id} playlist={p} wide />
              ))}
            </div>
          )}
        </>
      )}

      <PlaylistFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/playlists/${p.id}`)} />
    </div>
  );
}
