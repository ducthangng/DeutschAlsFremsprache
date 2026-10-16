import { useEffect, useRef, useState } from "react";
import { api, type Recording } from "../lib/api";
import { useDialog } from "./Dialog";
import { playAudio, type Playback } from "../lib/audio";
import { formatUsd } from "../lib/format";

const blobCache = new Map<number, Blob>();

export default function RecordingList({
  recordings,
  threshold,
  onDeleted,
}: {
  recordings: Recording[];
  threshold: number;
  onDeleted: (id: number) => void;
}) {
  const [playing, setPlaying] = useState<number | null>(null);
  const pb = useRef<Playback | null>(null);
  const dialog = useDialog();

  useEffect(() => () => pb.current?.stop(), []);

  async function play(r: Recording) {
    pb.current?.stop();
    if (playing === r.id) {
      setPlaying(null);
      return;
    }
    setPlaying(r.id);
    try {
      let blob = blobCache.get(r.id);
      if (!blob) {
        blob = await api.recordingAudio(r.id);
        blobCache.set(r.id, blob);
      }
      pb.current = playAudio(blob);
      await pb.current.done;
    } catch {
      /* playback failed or file missing */
    } finally {
      setPlaying((p) => (p === r.id ? null : p));
    }
  }

  async function remove(r: Recording) {
    if (!(await dialog.confirm({ title: "Xoá bản ghi này?", message: "Không thể hoàn tác.", confirmText: "Xoá", danger: true }))) return;
    await api.deleteRecording(r.id);
    blobCache.delete(r.id);
    onDeleted(r.id);
  }

  if (recordings.length === 0) return <p className="text-sm text-slate-400">Chưa có bản ghi đạt nào cho câu này.</p>;

  return (
    <ul className="space-y-1.5">
      {recordings.map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <button
            onClick={() => play(r)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-indigo-600 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50"
            aria-label={playing === r.id ? "Dừng" : "Phát"}
          >
            {playing === r.id ? "■" : "▶"}
          </button>
          <span className={`font-semibold ${r.score >= threshold ? "text-emerald-600" : "text-slate-600"}`}>{Math.round(r.score)}</span>
          <span className="flex-1 text-slate-500">{new Date(r.createdAt).toLocaleString("vi-VN")}</span>
          <span className="text-xs tabular-nums text-slate-400" title="Chi phí chấm điểm lượt này (Azure)">
            {r.costUsd > 0 ? `≈ ${formatUsd(r.costUsd)}` : "miễn phí"}
          </span>
          <button
            onClick={() => api.downloadRecording(r.id).catch((e) => dialog.alert("Không tải được bản ghi", e.message))}
            className="text-xs text-slate-500 hover:text-indigo-600"
            title="Tải file WAV"
          >
            ⬇ Tải
          </button>
          <button onClick={() => remove(r)} className="text-xs text-slate-400 hover:text-red-600">
            Xoá
          </button>
        </li>
      ))}
    </ul>
  );
}
