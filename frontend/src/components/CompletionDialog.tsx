import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api, type CompletionSummary, type TopicDetail } from "../lib/api";
import AddVocabDialog from "./AddVocabDialog";
import { ScoreDistribution } from "./Charts";
import { Modal } from "./Dialog";
import Spinner from "./Spinner";

/** "45 giây", "3 phút 12 giây", "2 giờ 5 phút" */
function duration(sec: number) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} giây`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h === 0) return s ? `${m} phút ${s} giây` : `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function cheer(top: number, users: number) {
  if (users <= 1) return "Bạn là người tiên phong ở đây. Hãy giữ phong độ! 🚀";
  if (top <= 10) return "Bạn thuộc nhóm dẫn đầu! Phát âm của bạn thật sự ấn tượng. 🔥";
  if (top <= 30) return "Tuyệt vời! Bạn đang làm tốt hơn phần lớn người học. 🌟";
  if (top <= 60) return "Bạn đang tiến bộ đều. Thêm vài topic nữa là lên top! 💪";
  return "Mỗi lần luyện là một bước tiến. Cứ đều đặn, bạn sẽ thấy khác biệt! 🌱";
}

const CONFETTI_COLORS = ["#ffda1a", "#6d70f3", "#22c08a", "#f87171", "#3987e5", "#fda4af"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.6,
        dur: 2.2 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        spin: 360 + Math.random() * 540,
        w: 6 + Math.random() * 6,
        round: Math.random() < 0.3,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute top-0 block"
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.round ? p.w : p.w * 0.45,
              borderRadius: p.round ? "999px" : "2px",
              background: p.color,
              "--delay": `${p.delay}s`,
              "--dur": `${p.dur}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Congratulations after finishing a topic: speaking time gained, new words
 * collected, and where the learner stands among everyone.
 */
export default function CompletionDialog({ topic, since, mode, onClose }: { topic: TopicDetail; since: string; mode: "shadow" | "write"; onClose: () => void }) {
  const [data, setData] = useState<CompletionSummary | null>(null);
  const [error, setError] = useState("");
  const [addVocab, setAddVocab] = useState(false);
  const navigate = useNavigate();

  const load = () => api.topicSummary(topic.id, since).then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.id, since]);

  const sp = data?.speaking;
  const goalPct = sp ? Math.min(100, (sp.totalSec / sp.goalSec) * 100) : 0;
  const r = data?.rank;

  return (
    <>
      <Modal open={!addVocab} onClose={onClose} width="max-w-2xl">
        <div className="relative">
          <Confetti />
          <div className="text-center">
            <div className="animate-pop-in text-6xl">🎉</div>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">Hoàn thành!</h2>
            <p className="mt-1 text-slate-500">
              Bạn đã {mode === "write" ? "nghe – viết" : "đọc"} đạt mọi câu của <b className="text-slate-800">{topic.title}</b>
            </p>
          </div>

          {!data && !error && <Spinner className="mx-auto mt-8" />}
          {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

          {data && sp && r && (
            <div className="mt-7 space-y-4">
              {/* speaking time */}
              <section className="rounded-2xl bg-slate-100 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-600">🗣 Thời gian nói</h3>
                  <span className="text-xs text-slate-400">Hành trình 10.000 giờ: {sp.tenKPercent.toLocaleString("vi-VN", { maximumFractionDigits: 4 })}%</span>
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                  <span className="text-3xl font-bold text-emerald-600">+{duration(data.session.speakingSec)}</span>
                  <span className="text-slate-500">
                    hôm nay · tổng cộng <b className="text-slate-800">{duration(sp.totalSec)}</b>
                  </span>
                </div>
                <div className="mt-3 h-2.5 rounded-full bg-[#1f3a63]">
                  <div className="h-2.5 rounded-full bg-[#3987e5] transition-all duration-1000" style={{ width: `${goalPct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Mục tiêu tiếp theo: <b className="text-slate-600">{duration(sp.goalSec)}</b> · còn {duration(Math.max(0, sp.goalSec - sp.totalSec))}
                </p>
              </section>

              {/* new words */}
              <section className="rounded-2xl bg-slate-100 p-5">
                <h3 className="text-sm font-semibold text-slate-600">📚 Từ mới thu thập ({data.newWords.length})</h3>
                {data.newWords.length === 0 ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">Lưu vài từ của topic này để ôn bằng flash card nhé!</p>
                    <button onClick={() => setAddVocab(true)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                      ＋ Lưu từ vựng
                    </button>
                  </div>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {data.newWords.map((v) => (
                      <li key={v.id} className="flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 text-sm ring-1 ring-slate-200">
                        {v.imageUrl ? <img src={v.imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="pl-2 text-emerald-600">✓</span>}
                        <span className="font-medium text-slate-900">{v.term}</span>
                        {v.meaning && <span className="text-slate-400">· {v.meaning}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* score & ranking */}
              <section className="rounded-2xl bg-slate-100 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-600">🏆 Điểm phát âm trung bình</h3>
                    <p className="mt-1 text-4xl font-bold text-slate-900">{r.avgScore === null ? "–" : Math.round(r.avgScore)}</p>
                    {data.session.gradings > 0 && <p className="text-xs text-slate-400">Topic này: {Math.round(data.session.avgScore)} điểm</p>}
                    {mode === "write" && data.session.dictationAttempts > 0 && <p className="text-xs text-slate-400">Nghe – Viết: {Math.round(data.session.dictationAvg)} điểm</p>}
                  </div>
                  {r.avgScore !== null && (
                    <div className="text-right">
                      <span className="animate-pop-in inline-block rounded-full bg-[#ffda1a] px-4 py-1.5 text-lg font-bold text-black">Top {r.topPercent}%</span>
                      <p className="mt-1 text-xs text-slate-400">
                        Hạng {r.position} / {r.users} người học
                      </p>
                    </div>
                  )}
                </div>
                {r.avgScore !== null ? (
                  <>
                    <p className="mt-2 text-sm text-slate-600">{cheer(r.topPercent, r.users)}</p>
                    <div className="mt-4">
                      <ScoreDistribution buckets={r.buckets} mine={r.avgScore} />
                      <p className="mt-1 text-center text-[11px] text-slate-400">Phân bố điểm trung bình của tất cả người học</p>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">Luyện thêm ở chế độ Shadowing để có điểm phát âm và xếp hạng nhé!</p>
                )}
              </section>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => navigate("/topics")} className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500">
              Topic tiếp theo →
            </button>
            <button onClick={onClose} className="rounded-xl px-5 py-2.5 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
              Luyện lại
            </button>
          </div>
        </div>
      </Modal>
      {addVocab && (
        <AddVocabDialog
          topic={topic}
          onClose={() => {
            setAddVocab(false);
            load(); // show the words just saved
          }}
        />
      )}
    </>
  );
}
