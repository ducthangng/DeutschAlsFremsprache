import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDialog } from "../components/Dialog";
import { AssessedText } from "../components/LineText";
import SelectionLookup from "../components/SelectionLookup";
import Spinner from "../components/Spinner";
import { api, ApiError, LANGUAGES, type SimulationDetail, type SimulationTurn } from "../lib/api";
import { openMicrophone, playAudio, Recorder, speak, type Playback } from "../lib/audio";
import { formatUsd } from "../lib/format";
import { usePrefs } from "../lib/prefs";

type Phase = "idle" | "recording" | "sending";

const scoreColor = (v: number) => (v >= 80 ? "text-emerald-600" : v >= 60 ? "text-amber-700" : "text-red-600");

export default function SimulationRun() {
  const id = Number(useParams().id);
  const [sim, setSim] = useState<SimulationDetail | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [prefs] = usePrefs();
  const dialog = useDialog();
  const recorder = useRef<Recorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const playback = useRef<Playback | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastSpoken = useRef(0);

  useEffect(() => {
    api.getSimulation(id).then(setSim, (e) => setError(e.message));
    return () => {
      playback.current?.stop();
      recorder.current?.cancel();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [id]);

  // Speak each new partner line once, and keep the newest message in view.
  useEffect(() => {
    if (!sim) return;
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    const last = sim.turns[sim.turns.length - 1];
    if (last?.speaker === "ai" && last.id !== lastSpoken.current && sim.status === "active") {
      lastSpoken.current = last.id;
      play(last);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim?.turns.length]);

  async function play(t: SimulationTurn) {
    playback.current?.stop();
    setSpeaking(t.id);
    try {
      if (t.speaker === "user" || sim!.voiceGenerated) {
        if (!t.hasAudio) setVoiceStatus("Generating…");
        const clip = await api.turnSpeech(id, t.id);
        if (!t.hasAudio) setSim((s) => s && { ...s, turns: s.turns.map((x) => (x.id === t.id ? { ...x, hasAudio: true } : x)) });
        setVoiceStatus("Loading…");
        playback.current = playAudio(clip.url, { rate: t.speaker === "ai" ? prefs.rate : 1, onStart: () => setVoiceStatus("") });
      } else {
        playback.current = speak(t.text, { lang: sim!.language, rate: prefs.rate, voiceURI: prefs.voice[sim!.language] || undefined });
      }
      await playback.current.done;
    } catch {
      // fall back to the browser voice for partner lines
      if (t.speaker === "ai") {
        playback.current = speak(t.text, { lang: sim!.language, rate: prefs.rate });
        await playback.current.done;
      }
    } finally {
      setSpeaking(null);
      setVoiceStatus("");
    }
  }

  function sayCorrection(text: string) {
    playback.current?.stop();
    playback.current = speak(text, { lang: sim!.language, rate: prefs.rate, voiceURI: prefs.voice[sim!.language] || undefined });
  }

  async function send(input: { audio?: Blob; text?: string }) {
    setPhase("sending");
    setNotice("");
    try {
      setSim(await api.simulationTurn(id, input));
      setText("");
    } catch (e) {
      setNotice(e instanceof ApiError && e.status === 422 ? "Không nghe rõ bạn nói gì. Hãy nói to và rõ hơn rồi thử lại." : e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setPhase("idle");
    }
  }

  async function startRecording() {
    playback.current?.stop();
    setNotice("");
    try {
      stream.current ??= await openMicrophone();
    } catch (e) {
      setNotice(e instanceof DOMException ? "Không truy cập được micro. Hãy cho phép quyền ghi âm, hoặc bấm ⌨️ để gõ." : (e as Error).message);
      return;
    }
    setPhase("recording");
    recorder.current = new Recorder(stream.current, { onLevel: setLevel, onAutoStop: () => stopRecording(), silenceMs: 1800, maxMs: 45000 });
  }

  async function stopRecording() {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setPhase("sending");
    const heard = rec.heardSpeech;
    const wav = await rec.stop();
    if (!heard) {
      setPhase("idle");
      setNotice("Không nghe thấy giọng của bạn (chưa gửi đi, không tốn phí).");
      return;
    }
    send({ audio: wav });
  }

  async function finishEarly() {
    const ok = await dialog.confirm({
      title: "Kết thúc mô phỏng?",
      message: "Bạn sẽ nhận bản nhận xét tổng kết dựa trên những lượt đã nói. Không thể nói tiếp sau khi kết thúc.",
      confirmText: "Kết thúc & xem tổng kết",
    });
    if (!ok) return;
    setPhase("sending");
    try {
      setSim(await api.finishSimulation(id));
    } finally {
      setPhase("idle");
    }
  }

  // Space toggles recording when not typing.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (typing || sim?.status !== "active" || e.code !== "Space" || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    if (phase === "idle") startRecording();
    else if (phase === "recording") stopRecording();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;
  if (!sim) return <Spinner className="mx-auto mt-24" />;

  const sc = sim.scenario;
  const round = sim.turns.filter((t) => t.speaker === "user").length;
  const active = sim.status === "active";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <SelectionLookup language={sim.language} rate={prefs.rate} voiceURI={prefs.voice[sim.language] || undefined} />
      <Link to="/simulations" className="text-sm text-slate-400 hover:text-slate-700">
        ← Mô phỏng
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        {/* Conversation */}
        <section className="lg:col-span-2">
          <div className="space-y-5">
            {sim.turns.map((t) =>
              t.speaker === "ai" ? (
                <PartnerBubble key={t.id} turn={t} partner={sc.partner} speaking={speaking === t.id} voiceStatus={speaking === t.id ? voiceStatus : ""} onPlay={() => play(t)} />
              ) : (
                <UserBubble key={t.id} turn={t} onPlay={() => play(t)} onSay={sayCorrection} />
              ),
            )}
            {phase === "sending" && (
              <div className="flex items-center gap-3 pl-2 text-sm text-slate-400">
                <Spinner className="h-5 w-5" /> Đang ghi lại, chấm phát âm và chờ {sc.partner.split(",")[0]} trả lời…
              </div>
            )}
          </div>

          {sim.summary && <SummaryCard sim={sim} />}
          <div ref={bottom} />

          {/* Composer */}
          {active && (
            <div className="sticky bottom-4 mt-8 rounded-2xl bg-surface/95 p-4 shadow-2xl ring-1 ring-slate-200 backdrop-blur">
              {notice && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
              {typing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim()) send({ text: text.trim() });
                  }}
                  className="flex gap-2"
                >
                  <input
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={500}
                    lang={sim.language}
                    placeholder="Gõ câu trả lời của bạn…"
                    className="flex-1 rounded-xl border border-slate-200 bg-transparent px-4 py-2.5 outline-none focus:border-indigo-300"
                  />
                  <button disabled={phase !== "idle" || !text.trim()} className="rounded-xl bg-indigo-600 px-5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
                    Gửi
                  </button>
                  <button type="button" onClick={() => setTyping(false)} className="rounded-xl px-3 text-slate-500 hover:bg-slate-100" title="Nói thay vì gõ">
                    🎤
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-4">
                  {phase === "recording" ? (
                    <button
                      onClick={stopRecording}
                      className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-red-500 text-xl text-white"
                      style={{ transform: `scale(${1 + level * 0.2})` }}
                      title="Xong (Space)"
                    >
                      <span className="animate-pulse-ring absolute inset-0 rounded-full bg-red-400" />■
                    </button>
                  ) : (
                    <button
                      onClick={startRecording}
                      disabled={phase !== "idle"}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-2xl text-white shadow-lg shadow-indigo-200 hover:bg-indigo-500 disabled:opacity-40"
                      title="Nói (Space)"
                    >
                      🎤
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{phase === "recording" ? "Đang nghe… nói xong sẽ tự gửi" : `Lượt ${round + 1}/${sim.maxRounds}: đến lượt bạn`}</p>
                    <p className="truncate text-sm text-slate-400">Mục tiêu: {sc.goal}</p>
                  </div>
                  <button onClick={() => setTyping(true)} className="rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-slate-100" title="Gõ thay vì nói">
                    ⌨️
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Scenario & costs */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
            <p className="text-xs text-slate-400">
              {LANGUAGES[sim.language].flag} {sim.level} · {active ? `Lượt ${round}/${sim.maxRounds}` : "Đã kết thúc"}
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">{sc.title}</h1>
            <div className="mt-2 h-1 rounded-full bg-slate-200">
              <div className="h-1 rounded-full bg-indigo-500 transition-all" style={{ width: `${(round / sim.maxRounds) * 100}%` }} />
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div>
                <dt className="text-slate-400">Bối cảnh</dt>
                <dd className="text-slate-700">{sc.setting}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Người đối thoại</dt>
                <dd className="text-slate-700">{sc.partner}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Vai của bạn</dt>
                <dd className="text-slate-700">{sc.userRole}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Mục tiêu</dt>
                <dd className="font-medium text-slate-800">{sc.goal}</dd>
              </div>
            </dl>
            {sc.usefulWords?.length > 0 && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-slate-500">Từ có thể dùng ({sc.usefulWords.length})</summary>
                <ul className="mt-2 space-y-1">
                  {sc.usefulWords.map((w) => (
                    <li key={w.term} data-lookup data-sentence={w.term}>
                      <span className="text-slate-800">{w.term}</span> <span className="text-slate-400">· {w.meaning}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {active && round > 0 && (
              <button onClick={finishEarly} disabled={phase !== "idle"} className="mt-5 w-full rounded-xl px-3 py-2 text-sm text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100">
                Kết thúc sớm & xem tổng kết
              </button>
            )}
          </div>
          <div className="rounded-2xl bg-surface p-5 text-sm ring-1 ring-slate-200">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-slate-700">Chi phí mô phỏng</span>
              <span className="font-semibold tabular-nums text-slate-900">≈ {formatUsd(sim.costs.totalUsd)}</span>
            </div>
            <ul className="mt-2 space-y-1 text-slate-500">
              <li className="flex justify-between">
                <span>Nhận dạng & chấm phát âm (Azure)</span>
                <span className="tabular-nums">{formatUsd(sim.costs.speechUsd)}</span>
              </li>
              <li className="flex justify-between">
                <span>Hội thoại & nhận xét (OpenAI)</span>
                <span className="tabular-nums">{formatUsd(sim.costs.llmUsd)}</span>
              </li>
              <li className="flex justify-between">
                <span>Giọng người đối thoại</span>
                <span className="tabular-nums">{formatUsd(sim.costs.ttsUsd)}</span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-slate-400">
              {sim.costs.tokens.toLocaleString("vi-VN")} token · {Math.round(sim.costs.audioSeconds)} giây audio
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PartnerBubble({ turn, partner, speaking, voiceStatus, onPlay }: { turn: SimulationTurn; partner: string; speaking: boolean; voiceStatus: string; onPlay: () => void }) {
  const [showVi, setShowVi] = useState(false);
  return (
    <div className="max-w-[85%]">
      <p className="mb-1 pl-1 text-xs text-slate-400">{partner}</p>
      <div className="rounded-2xl rounded-tl-md bg-surface px-5 py-3.5 ring-1 ring-slate-200">
        <p data-lookup data-sentence={turn.text} className="text-lg leading-relaxed text-slate-900 selection:bg-amber-200">
          {turn.text}
        </p>
        {showVi && <p className="mt-1 text-slate-400">{turn.translation}</p>}
        <div className="mt-2 flex gap-3 text-xs text-slate-400">
          <button onClick={onPlay} className="hover:text-slate-700">
            {speaking ? (voiceStatus || "🔊 Đang đọc…") : "🔊 Nghe lại"}
          </button>
          {turn.translation && (
            <button onClick={() => setShowVi((v) => !v)} className="hover:text-slate-700">
              {showVi ? "Ẩn nghĩa" : "👁 Nghĩa"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ turn, onPlay, onSay }: { turn: SimulationTurn; onPlay: () => void; onSay: (text: string) => void }) {
  const ev = turn.evaluation;
  return (
    <div className="ml-auto max-w-[85%]">
      <p className="mb-1 pr-1 text-right text-xs text-slate-400">Bạn · lượt {turn.round}</p>
      <div className="rounded-2xl rounded-tr-md bg-indigo-100 px-5 py-3.5 ring-1 ring-indigo-200">
        <p className="text-lg leading-relaxed text-slate-900">{ev?.words?.length ? <AssessedText tokens={ev.words} /> : turn.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {turn.pronScore !== null && (
            <span className="text-slate-500">
              Phát âm <b className={scoreColor(turn.pronScore)}>{Math.round(turn.pronScore)}</b>
            </span>
          )}
          {turn.logicScore !== null && (
            <span className="text-slate-500">
              Logic <b className={scoreColor(turn.logicScore)}>{Math.round(turn.logicScore)}</b>
            </span>
          )}
          {turn.typed && <span className="text-slate-400">⌨️ đã gõ</span>}
          {turn.hasAudio && (
            <button onClick={onPlay} className="text-slate-500 hover:text-slate-800">
              ▶ Giọng tôi
            </button>
          )}
          <span className="ml-auto text-slate-400" title="Chi phí lượt này">
            ≈ {formatUsd(turn.costUsd)}
          </span>
        </div>
      </div>
      {ev && (
        <div className="mt-2 space-y-1.5 rounded-xl bg-surface px-4 py-3 text-sm ring-1 ring-slate-200">
          {ev.feedback && <p className="text-slate-600">💬 {ev.feedback}</p>}
          {ev.corrected && ev.corrected.trim().toLowerCase() !== turn.text.trim().toLowerCase() && (
            <p className="text-slate-500">
              ✨ Tự nhiên hơn:{" "}
              <button onClick={() => onSay(ev.corrected)} className="text-left font-medium text-emerald-700 hover:underline" title="Nghe">
                {ev.corrected}
              </button>
            </p>
          )}
          {ev.grammarNote && <p className="text-slate-500">📘 {ev.grammarNote}</p>}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ sim }: { sim: SimulationDetail }) {
  const s = sim.summary!;
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const mins = Math.max(1, Math.round(s.durationSec / 60));

  async function save(phrase: string, meaning: string) {
    try {
      await api.createVocab({ language: sim.language, term: phrase, meaning, example: "" });
    } catch {
      // already in the pocket is fine
    }
    setSaved((x) => new Set(x).add(phrase));
  }

  return (
    <section className="mt-10 rounded-3xl bg-surface p-6 ring-1 ring-slate-200 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Tổng kết</p>
      <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-4">
        {s.overall !== undefined && (
          <div>
            <p className="text-5xl font-bold text-slate-900">{Math.round(s.overall)}</p>
            <p className="text-sm text-slate-400">điểm giao tiếp</p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          {[
            ["Mục tiêu", s.goalReached === undefined ? "–" : s.goalReached ? "✓ Đạt" : "Chưa đạt"],
            ["Trình độ thể hiện", s.cefr ?? "–"],
            ["Phát âm TB", s.avgPron === null ? "–" : Math.round(s.avgPron)],
            ["Logic TB", s.avgLogic === null ? "–" : Math.round(s.avgLogic)],
            ["Số lượt", s.rounds],
            ["Thời gian", `${mins} phút`],
            ["Chi phí", `≈ ${formatUsd(sim.costs.totalUsd)}`],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="text-slate-400">{k}</dt>
              <dd className="font-semibold text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {s.verdict && <p className="mt-6 text-lg text-slate-700">{s.verdict}</p>}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {s.strengths && s.strengths.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-emerald-700">Điểm mạnh</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              {s.strengths.map((x) => (
                <li key={x}>✓ {x}</li>
              ))}
            </ul>
          </div>
        )}
        {s.improvements && s.improvements.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-amber-700">Cần cải thiện</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              {s.improvements.map((x) => (
                <li key={x}>→ {x}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {s.usefulPhrases && s.usefulPhrases.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-slate-700">Cụm từ nên học</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {s.usefulPhrases.map((p) => (
              <li key={p.phrase} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="text-slate-900">{p.phrase}</span> <span className="text-slate-400">· {p.meaning}</span>
                </span>
                <button
                  disabled={saved.has(p.phrase)}
                  onClick={() => save(p.phrase, p.meaning)}
                  className="rounded-lg px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:text-emerald-600"
                >
                  {saved.has(p.phrase) ? "✓ Đã lưu" : "＋ Pocket"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link to="/simulations" className="mt-8 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500">
        🎲 Mô phỏng mới
      </Link>
    </section>
  );
}
