import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "../components/Avatar";
import { LanguageBadge } from "../components/Cards";
import { DictationTokens } from "../components/Dictation";
import { Modal } from "../components/Dialog";
import { AssessedText } from "../components/LineText";
import Spinner from "../components/Spinner";
import { api, type Activity, type ActivityKind, type ReviewLine, type SimulationDetail } from "../lib/api";
import { playAudio, type Playback } from "../lib/audio";

const KINDS: Record<ActivityKind, { label: string; verb: string; icon: string; color: string }> = {
  shadow: { label: "Luyện nói", verb: "luyện nói", icon: "🎤", color: "bg-[#3987e5]/15 text-[#8ab8f2]" },
  write: { label: "Nghe – Viết", verb: "nghe – viết", icon: "✍️", color: "bg-[#8b5cf6]/15 text-[#c4b5fd]" },
  simulation: { label: "Mô phỏng", verb: "hội thoại mô phỏng", icon: "💬", color: "bg-amber-100 text-amber-700" },
  create: { label: "Tạo topic", verb: "tạo topic", icon: "＋", color: "bg-emerald-100 text-emerald-700" },
};

const tone = (score: number) => (score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-500");

/** "vừa xong", "5 phút trước", "3 giờ trước", then the date. */
function ago(iso: string) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "vừa xong";
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ trước`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

function span(a: Activity) {
  const min = Math.round((new Date(a.lastAt).getTime() - new Date(a.startedAt).getTime()) / 60000);
  return min < 1 ? "< 1 phút" : `${min} phút`;
}

function KindBadge({ kind }: { kind: ActivityKind }) {
  const k = KINDS[kind];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${k.color}`}>{k.icon} {k.label}</span>;
}

/** Plays one audio source at a time across the page. */
function usePlayer() {
  const current = useRef<Playback | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => current.current?.stop(), []);
  async function toggle(key: string, load: () => Promise<Blob | string>) {
    current.current?.stop();
    current.current = null;
    if (playing === key) {
      setPlaying(null);
      return;
    }
    setError("");
    setPlaying(key);
    try {
      const p = playAudio(await load());
      current.current = p;
      await p.done;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không phát được");
    } finally {
      setPlaying((k) => (k === key ? null : k));
    }
  }
  return { playing, toggle, error };
}

function PlayButton({ active, onClick, label = "Nghe" }: { active: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition ${
        active ? "bg-indigo-600 text-white ring-indigo-600" : "text-slate-600 ring-slate-200 hover:bg-slate-100"
      }`}
    >
      {active ? "■ Dừng" : `▶ ${label}`}
    </button>
  );
}

export default function ActivityPage() {
  const [kind, setKind] = useState<ActivityKind | "">("");
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Activity | null>(null);

  useEffect(() => {
    setRows(null);
    api.adminActivity({ kind, userId: user?.id }).then(
      (r) => {
        setRows(r.activity);
        setHasMore(r.hasMore);
      },
      (e) => setError(e.message),
    );
  }, [kind, user]);

  async function loadMore() {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const r = await api.adminActivity({ kind, userId: user?.id }, rows.length);
      setRows([...rows, ...r.activity]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được");
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Hoạt động người học</h1>
      <p className="mt-1 text-sm text-slate-500">Mỗi dòng là một buổi: một người, một topic, một ngày (giờ Việt Nam). Bấm “Xem lại” để nghe bản ghi và xem bài làm.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-xl bg-surface p-1 ring-1 ring-slate-200">
          {([["", "Tất cả"], ...Object.entries(KINDS).map(([k, v]) => [k, `${v.icon} ${v.label}`])] as [ActivityKind | "", string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${kind === k ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {user && (
          <span className="flex items-center gap-1.5 rounded-full bg-indigo-100 py-1 pl-3 pr-1.5 text-sm text-indigo-700">
            {user.name}
            <button onClick={() => setUser(null)} className="rounded-full px-1.5 hover:bg-indigo-200" title="Bỏ lọc">
              ✕
            </button>
          </span>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-surface ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Khi nào</th>
              <th className="px-3 py-2 font-medium">Người dùng</th>
              <th className="px-3 py-2 font-medium">Hoạt động</th>
              <th className="px-3 py-2 font-medium">Topic</th>
              <th className="px-3 py-2 font-medium">Kết quả</th>
              <th className="px-3 py-2 text-right font-medium">Thời lượng</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!rows && (
              <tr>
                <td colSpan={7} className="py-8">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Chưa có hoạt động nào.
                </td>
              </tr>
            )}
            {rows?.map((a) => (
              <tr key={`${a.kind}-${a.userId}-${a.topicId}-${a.simulationId}-${a.day}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-100/60">
                <td className="whitespace-nowrap px-3 py-2.5">
                  <div className="text-slate-800">{ago(a.lastAt)}</div>
                  <div className="text-xs text-slate-400">{new Date(a.lastAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}</div>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => setUser({ id: a.userId, name: a.userName })} className="flex items-center gap-2 text-left hover:underline" title="Chỉ xem người này">
                    <Avatar name={a.userName} url={a.userAvatarUrl} size={26} />
                    <span className="whitespace-nowrap font-medium text-slate-900">{a.userName}</span>
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <KindBadge kind={a.kind} />
                </td>
                <td className="max-w-[16rem] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {a.language && <LanguageBadge language={a.language} size="sm" />}
                    {a.kind === "simulation" ? (
                      <span className="truncate text-slate-800">{a.simulationTitle || `Mô phỏng #${a.simulationId}`}</span>
                    ) : a.topicTitle ? (
                      <Link to={`/topics/${a.topicId}`} className="truncate text-slate-800 hover:underline">
                        {a.topicTitle}
                      </Link>
                    ) : (
                      <i className="text-slate-400">topic đã xoá</i>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  <Result a={a} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs tabular-nums text-slate-500">{a.kind === "create" ? "–" : span(a)}</td>
                <td className="px-3 py-2.5 text-right">
                  {a.kind !== "create" && (a.topicTitle || a.kind === "simulation") && (
                    <button onClick={() => setOpen(a)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                      {a.kind === "shadow" ? "🎧 Nghe lại" : "👁 Xem lại"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button onClick={loadMore} disabled={loadingMore} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-surface disabled:opacity-50">
            {loadingMore ? "Đang tải…" : "Tải thêm"}
          </button>
        </div>
      )}

      {open && <ReviewDialog activity={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Result({ a }: { a: Activity }) {
  if (a.kind === "create") return <span>{a.topicLines} câu</span>;
  if (a.kind === "simulation")
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <span>{a.lines} lượt nói</span>
        {a.avgScore > 0 && (
          <span>
            · TB <b className={tone(a.avgScore)}>{Math.round(a.avgScore)}</b>
          </span>
        )}
        <span className={a.simulationStatus === "finished" ? "text-emerald-600" : "text-slate-400"}>· {a.simulationStatus === "finished" ? "đã xong" : "đang dở"}</span>
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span>
        <b className="text-slate-800">{a.lines}</b>/{a.topicLines} câu
      </span>
      <span>· {a.attempts} lượt</span>
      <span>
        · TB <b className={tone(a.avgScore)}>{Math.round(a.avgScore)}</b>
      </span>
      {a.completed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ Hoàn thành</span>}
    </span>
  );
}

function ReviewDialog({ activity: a, onClose }: { activity: Activity; onClose: () => void }) {
  const title = a.kind === "simulation" ? a.simulationTitle || `Mô phỏng #${a.simulationId}` : a.topicTitle;
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <Avatar name={a.userName} url={a.userAvatarUrl} size={28} />
          <span>{a.userName}</span>
          <span className="font-normal text-slate-400">·</span>
          <KindBadge kind={a.kind} />
          <span className="font-normal text-slate-500">{title}</span>
          <span className="text-xs font-normal text-slate-400">{new Date(a.startedAt).toLocaleDateString("vi-VN")}</span>
        </div>
      }
    >
      <div className="-mx-2 max-h-[72vh] overflow-y-auto px-2">{a.kind === "simulation" ? <SimulationReview id={a.simulationId} /> : <TopicReview a={a} />}</div>
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="rounded-xl px-5 py-2 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
          Đóng
        </button>
      </div>
    </Modal>
  );
}

function TopicReview({ a }: { a: Activity }) {
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const player = usePlayer();

  useEffect(() => {
    api.adminReview(a.userId, a.topicId, a.day).then(setLines, (e) => setError(e.message));
  }, [a]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!lines) return <Spinner className="mx-auto my-10" />;

  const done = (l: ReviewLine) => (a.kind === "write" ? l.dictation.length > 0 : l.attempts.length > 0 || l.recordings.length > 0);
  const shown = all ? lines : lines.filter(done);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          Đã làm {lines.filter(done).length}/{lines.length} câu
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-indigo-600" />
          Hiện cả câu chưa làm
        </label>
      </div>
      {player.error && <p className="mb-2 text-sm text-red-600">{player.error}</p>}
      <ol className="space-y-3">
        {shown.map((l) => (
          <li key={l.id} className={`rounded-xl p-4 ring-1 ring-slate-200 ${done(l) ? "bg-slate-100/60" : "opacity-50"}`}>
            <p className="text-xs text-slate-400">
              Câu {l.position + 1}
              {l.speaker && <span className="ml-1 font-semibold text-slate-500">· {l.speaker}</span>}
            </p>
            <p className="mt-0.5 font-medium text-slate-900">{l.text}</p>
            {l.note && <p className="text-xs text-slate-400">{l.note}</p>}

            {a.kind === "shadow" && (
              <>
                {l.attempts.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-slate-400">Các lượt:</span>
                    {l.attempts.map((t, i) => (
                      <span
                        key={i}
                        title={new Date(t.createdAt).toLocaleTimeString("vi-VN")}
                        className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ring-1 ${t.passed ? "text-emerald-600 ring-emerald-200" : "text-red-500 ring-red-200"}`}
                      >
                        {Math.round(t.score)}
                      </span>
                    ))}
                  </div>
                )}
                {l.recordings.map((r) => (
                  <div key={r.id} className="mt-3 rounded-lg bg-surface p-3 ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center gap-3">
                      <PlayButton active={player.playing === `r${r.id}`} onClick={() => player.toggle(`r${r.id}`, () => api.adminRecordingAudio(r.id))} label="Giọng người học" />
                      <span className={`text-lg font-bold tabular-nums ${tone(r.score)}`}>{Math.round(r.score)}</span>
                      <span className="text-xs text-slate-400">
                        Chính xác {Math.round(r.accuracy)} · Trôi chảy {Math.round(r.fluency)} · Đầy đủ {Math.round(r.completeness)}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">{new Date(r.createdAt).toLocaleTimeString("vi-VN")}</span>
                    </div>
                    {r.result.tokens?.length ? (
                      <p className="mt-2 text-base">
                        <AssessedText tokens={r.result.tokens} />
                      </p>
                    ) : null}
                    {r.result.recognized && <p className="mt-1 text-xs text-slate-400">Azure nghe được: “{r.result.recognized}”</p>}
                  </div>
                ))}
                {l.attempts.length > 0 && l.recordings.length === 0 && <p className="mt-2 text-xs text-slate-400">Chưa có lượt đạt nên không lưu bản ghi.</p>}
              </>
            )}

            {a.kind === "write" &&
              l.dictation.map((d) => (
                <div key={d.id} className="mt-3 rounded-lg bg-surface p-3 ring-1 ring-slate-200">
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`text-lg font-bold tabular-nums ${d.passed ? "text-emerald-600" : tone(d.score)}`}>{Math.round(d.score)}</span>
                    <span className={d.passed ? "text-emerald-600" : "text-slate-400"}>{d.passed ? "Đạt" : "Chưa đạt"}</span>
                    <span className="ml-auto text-slate-400">{new Date(d.createdAt).toLocaleTimeString("vi-VN")}</span>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-2 gap-y-2 text-base">{d.answer ? <DictationTokens tokens={d.tokens} /> : <i className="text-slate-400">(để trống)</i>}</p>
                </div>
              ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SimulationReview({ id }: { id: number }) {
  const [data, setData] = useState<{ simulation: SimulationDetail; audioUrls: Record<number, string> } | null>(null);
  const [error, setError] = useState("");
  const player = usePlayer();

  useEffect(() => {
    api.adminSimulation(id).then(setData, (e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <Spinner className="mx-auto my-10" />;
  const sim = data.simulation;
  const sum = sim.summary;

  return (
    <div>
      <div className="rounded-xl bg-slate-100 p-4 text-sm">
        <p className="text-slate-600">{sim.scenario.setting}</p>
        {sim.scenario.goal && (
          <p className="mt-1 text-slate-500">
            🎯 <b className="text-slate-700">Mục tiêu:</b> {sim.scenario.goal}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {sim.level} · {sim.status === "finished" ? "đã kết thúc" : "đang dở"} · chi phí ≈ ${sim.costs.totalUsd.toFixed(4)}
        </p>
      </div>
      {player.error && <p className="mt-2 text-sm text-red-600">{player.error}</p>}

      <div className="mt-4 space-y-3">
        {sim.turns.map((t) => {
          const url = data.audioUrls[t.id];
          const ev = t.evaluation;
          return t.speaker === "ai" ? (
            <div key={t.id} className="max-w-[85%]">
              <div className="rounded-2xl rounded-tl-md bg-slate-100 px-4 py-3">
                <p className="text-slate-900">{t.text}</p>
                {t.translation && <p className="mt-1 text-xs text-slate-400">{t.translation}</p>}
                {url && (
                  <div className="mt-2">
                    <PlayButton active={player.playing === `t${t.id}`} onClick={() => player.toggle(`t${t.id}`, async () => url)} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={t.id} className="ml-auto max-w-[85%]">
              <div className="rounded-2xl rounded-tr-md bg-indigo-100 px-4 py-3 ring-1 ring-indigo-200">
                <p className="text-slate-900">{ev?.words?.length ? <AssessedText tokens={ev.words} /> : t.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {url && <PlayButton active={player.playing === `t${t.id}`} onClick={() => player.toggle(`t${t.id}`, async () => url)} label="Giọng người học" />}
                  {t.pronScore !== null && (
                    <span>
                      Phát âm <b className={tone(t.pronScore)}>{Math.round(t.pronScore)}</b>
                    </span>
                  )}
                  {t.logicScore !== null && (
                    <span>
                      Logic <b className={tone(t.logicScore)}>{Math.round(t.logicScore)}</b>
                    </span>
                  )}
                  {t.typed && <span className="text-slate-400">⌨️ đã gõ</span>}
                </div>
              </div>
              {ev && (ev.feedback || ev.corrected || ev.grammarNote) && (
                <div className="mt-1.5 space-y-1 rounded-xl bg-surface px-4 py-2.5 text-xs ring-1 ring-slate-200">
                  {ev.feedback && <p className="text-slate-600">💬 {ev.feedback}</p>}
                  {ev.corrected && ev.corrected.trim().toLowerCase() !== t.text.trim().toLowerCase() && <p className="text-emerald-700">✨ {ev.corrected}</p>}
                  {ev.grammarNote && <p className="text-slate-500">📘 {ev.grammarNote}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sum?.verdict && (
        <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200">
          <p className="font-semibold text-emerald-700">
            Tổng kết{sum.overall !== undefined && <> · {Math.round(sum.overall)} điểm</>}
            {sum.cefr && <> · {sum.cefr}</>}
          </p>
          <p className="mt-1 text-slate-600">{sum.verdict}</p>
        </div>
      )}
    </div>
  );
}
