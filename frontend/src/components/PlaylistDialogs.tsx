import { useEffect, useState, type FormEvent } from "react";
import { api, type Playlist, type PlaylistInput, type Visibility } from "../lib/api";
import { Modal } from "./Dialog";
import Spinner from "./Spinner";

const LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
const input = "w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-indigo-500";

/** Create or edit a playlist (name, level, description, visibility). */
export function PlaylistFormDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: Playlist;
  onClose: () => void;
  onSaved: (p: Playlist) => void;
}) {
  const [form, setForm] = useState<PlaylistInput>({ name: "", description: "", level: "", visibility: "private" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(initial ? { name: initial.name, description: initial.description, level: initial.level, visibility: initial.visibility } : { name: "", description: "", level: "", visibility: "private" });
      setError("");
    }
  }, [open, initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(initial ? await api.updatePlaylist(initial.id, form) : await api.createPlaylist(form));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Sửa playlist" : "Playlist mới"}>
      <form onSubmit={submit} className="space-y-3">
        <input className={input} autoFocus required maxLength={100} placeholder="Tên playlist, VD: Đi tàu ở Đức" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <textarea className={`${input} h-20 text-sm`} maxLength={500} placeholder="Mô tả (tuỳ chọn)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex gap-3">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-500">Trình độ</span>
            <select className={input} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l || "Không ghi"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-slate-500">Trạng thái</span>
            <select className={input} value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}>
              <option value="private">🔒 Riêng tư</option>
              <option value="public">🌐 Công khai</option>
            </select>
          </label>
        </div>
        {form.visibility === "public" && (
          <p className="text-xs text-slate-400">Mọi người có thể theo dõi playlist và thấy tiến độ của chính họ. Topic riêng tư của bạn trong playlist sẽ bị ẩn với người khác.</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Huỷ
          </button>
          <button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Đang lưu…" : initial ? "Lưu" : "Tạo playlist"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Tick the playlists a topic belongs to; changes apply immediately. */
export function AddToPlaylistDialog({ topicId, open, onClose }: { topicId: number; open: boolean; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [member, setMember] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    Promise.all([api.myPlaylists(), api.topicPlaylists(topicId)]).then(
      ([ps, ids]) => {
        setPlaylists(ps.filter((p) => p.isOwner));
        setMember(new Set(ids));
      },
      (e) => setError(e.message),
    );
  }, [open, topicId]);

  async function toggle(p: Playlist) {
    const has = member.has(p.id);
    const next = new Set(member);
    if (has) next.delete(p.id);
    else next.add(p.id);
    setMember(next);
    try {
      if (has) await api.removeFromPlaylist(p.id, topicId);
      else await api.addToPlaylist(p.id, topicId);
    } catch (e) {
      setMember(member);
      setError(e instanceof Error ? e.message : "Không cập nhật được");
    }
  }

  return (
    <>
      <Modal open={open && !creating} onClose={onClose} title="Thêm vào playlist">
        {!playlists && !error && <Spinner />}
        {playlists?.length === 0 && <p className="text-sm text-slate-500">Bạn chưa có playlist nào.</p>}
        <ul className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
          {playlists?.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-100">
                <input type="checkbox" checked={member.has(p.id)} onChange={() => toggle(p)} className="h-4 w-4 accent-indigo-600" />
                <span className="flex-1 text-slate-800">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {p.level && `${p.level} · `}
                  {p.visibility === "public" ? "🌐" : "🔒"}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-between">
          <button onClick={() => setCreating(true)} className="rounded-xl px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            ＋ Playlist mới
          </button>
          <button onClick={onClose} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            Xong
          </button>
        </div>
      </Modal>
      <PlaylistFormDialog
        open={open && creating}
        onClose={() => setCreating(false)}
        onSaved={async (p) => {
          await api.addToPlaylist(p.id, topicId).catch(() => {});
          setPlaylists((ps) => [p, ...(ps ?? [])]);
          setMember((m) => new Set(m).add(p.id));
        }}
      />
    </>
  );
}
