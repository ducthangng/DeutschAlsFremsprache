import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AddVocabDialog from "../components/AddVocabDialog";
import { AvatarStack } from "../components/Avatar";
import Dictation from "../components/Dictation";
import { AssessedText, KaraokeText } from "../components/LineText";
import { AddToPlaylistDialog } from "../components/PlaylistDialogs";
import RecordingList from "../components/RecordingList";
import { ScorePanel } from "../components/Scores";
import SelectionLookup from "../components/SelectionLookup";
import { SpeedControl, VoiceSelect } from "../components/SpeechControls";
import Spinner from "../components/Spinner";
import Popover from "../components/Popover";
import { api, LANGUAGES, saveBlob, type AssessResult, type GradingUsage, type Item, type Participant, type SpeechClip, type TopicCost, type TopicDetail } from "../lib/api";
import { openMicrophone, playAudio, Recorder, speak, voicesFor, type Playback } from "../lib/audio";
import { formatUsd } from "../lib/format";
import { usePrefs } from "../lib/prefs";

type Phase = "idle" | "playing" | "recording" | "assessing" | "result";
/** While phase is "playing" with generated speech: creating the clip, or fetching it from storage. */
type SpeechStatus = "" | "generating" | "loading";

const SPEECH_URL_TTL_MS = 50 * 60 * 1000; // server-signed URLs live 1 h

const SPEAKER_COLORS = ["text-indigo-700", "text-rose-700", "text-teal-700", "text-amber-700"];
const ADVANCE_DELAY_MS = 1800;

/** Quiet one-line cost note under a grading result; details in the tooltip. */
function UsageNote({ usage }: { usage: GradingUsage }) {
  if (usage.provider === "mock") return <span title="Chấm giả lập, không tính phí">mock</span>;
  return (
    <Link to="/usage" className="hover:text-indigo-600" title={`Azure · ${(usage.audioMs / 1000).toFixed(1)} giây audio · ${usage.latencyMs} ms`}>
      ≈ {formatUsd(usage.costUsd)}
    </Link>
  );
}

const iconBtn = "flex h-11 w-11 items-center justify-center rounded-xl text-lg text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40";

export default function Practice() {
  const topicId = Number(useParams().id);
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [take, setTake] = useState<Blob | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [mock, setMock] = useState(false);
  const [threshold, setThreshold] = useState(70);
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  const [translateError, setTranslateError] = useState("");
  const [openaiTts, setOpenaiTts] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("");
  const [costs, setCosts] = useState<TopicCost[] | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [prefs, setPrefs] = usePrefs();
  const [params, setParams] = useSearchParams();
  const mode: "shadow" | "write" = params.get("mode") === "write" ? "write" : "shadow";
  const [addToPlaylist, setAddToPlaylist] = useState(false);
  const [addVocab, setAddVocab] = useState(false);
  const [people, setPeople] = useState<Participant[]>([]);

  // Async flows read the latest state through refs; runId invalidates stale flows.
  const runId = useRef(0);
  const playback = useRef<Playback | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const advanceTimer = useRef<number>();
  const speechClips = useRef(new Map<number, { clip: SpeechClip; at: number }>());
  const passedThisSession = useRef(new Set<number>());
  const completedThisSession = useRef(false);
  const latest = useRef({ topic, role, prefs, openaiTts });
  latest.current = { topic, role, prefs, openaiTts };

  const refreshCosts = useCallback(() => {
    api.topicCosts(topicId).then(setCosts, () => {});
  }, [topicId]);

  useEffect(() => {
    api.getTopic(topicId).then(setTopic, (e) => setLoadError(e.message));
    api.health().then(
      (h) => {
        setMock(!h.azure);
        setThreshold(h.passThreshold);
        setOpenaiTts(h.openaiTts);
      },
      () => {},
    );
    refreshCosts();
    api.topicParticipants(topicId).then(setPeople, () => {});
  }, [topicId, refreshCosts]);

  // Vietnamese meaning for every line without a hand-written note.
  useEffect(() => {
    if (!topic) return;
    const texts = [...new Set(topic.items.filter((it) => !it.note).map((it) => it.text))];
    if (texts.length === 0) return;
    api.translate(topic.language, texts).then(
      (res) => setTranslations(new Map(texts.map((t, i) => [t, res.translations[i]]))),
      (e) => setTranslateError(e.message),
    );
    // Only re-translate when the set of lines changes, not on every recording update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic?.id, topic?.items.length]);

  const cancelAll = useCallback(() => {
    runId.current++;
    clearTimeout(advanceTimer.current);
    playback.current?.stop();
    playback.current = null;
    recorder.current?.cancel();
    recorder.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelAll();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [cancelAll],
  );

  const isMine = (item: Item) => !latest.current.role || item.speaker === latest.current.role;

  /** The chosen voice, or (automatic) a different browser voice for each speaker. */
  function voiceFor(item: Item): string | undefined {
    const { topic, prefs } = latest.current;
    const chosen = prefs.voice[topic!.language];
    if (chosen) return chosen;
    const voices = voicesFor(topic!.language);
    if (voices.length === 0) return undefined;
    return voices[Math.max(0, topic!.speakers.indexOf(item.speaker)) % voices.length].voiceURI;
  }

  /** With OpenAI configured: fetch (or generate once) the stored clip. */
  async function generatedSpeech(item: Item): Promise<SpeechClip> {
    const hit = speechClips.current.get(item.id);
    if (hit && Date.now() - hit.at < SPEECH_URL_TTL_MS) return hit.clip;
    setSpeechStatus(item.speechCached ? "loading" : "generating");
    const clip = await api.speech(item.id);
    speechClips.current.set(item.id, { clip, at: Date.now() });
    if (!clip.cached) {
      setTopic((t) => t && { ...t, items: t.items.map((it) => (it.id === item.id ? { ...it, speechCached: true } : it)) });
      if (clip.costUsd > 0) refreshCosts();
    }
    return clip;
  }

  async function playModel(item: Item, run: number): Promise<boolean> {
    const { topic, prefs, openaiTts } = latest.current;
    setPhase("playing");
    setProgress(0);
    let pb: Playback | null = null;
    if (openaiTts) {
      try {
        const clip = await generatedSpeech(item);
        if (run !== runId.current) return false;
        setSpeechStatus("loading");
        pb = playAudio(clip.url, { rate: prefs.rate, onProgress: setProgress, onStart: () => setSpeechStatus("") });
      } catch (e) {
        if (run !== runId.current) return false;
        setNotice(`Không lấy được giọng đọc OpenAI (${e instanceof Error ? e.message : e}); dùng giọng của trình duyệt.`);
      }
    }
    if (!pb) setSpeechStatus("");
    pb ??= speak(item.text, { lang: topic!.language, rate: prefs.rate, voiceURI: voiceFor(item), onProgress: setProgress });
    playback.current = pb;
    try {
      await pb.done;
    } finally {
      setSpeechStatus("");
    }
    return run === runId.current;
  }

  /** Plays one line once at a given speed (used by Listen -> Write). */
  async function playOnce(item: Item, rate: number) {
    playback.current?.stop();
    const { topic, openaiTts } = latest.current;
    let pb: Playback | null = null;
    if (openaiTts) {
      try {
        const clip = await generatedSpeech(item);
        setSpeechStatus("loading");
        pb = playAudio(clip.url, { rate, onStart: () => setSpeechStatus("") });
      } catch {
        setSpeechStatus("");
      }
    }
    pb ??= speak(item.text, { lang: topic!.language, rate, voiceURI: voiceFor(item) });
    playback.current = pb;
    try {
      await pb.done;
    } finally {
      setSpeechStatus("");
    }
  }

  function setMode(m: "shadow" | "write") {
    stopEverything();
    setParams(m === "write" ? { mode: "write" } : {}, { replace: true });
  }

  async function runLine(idx: number, opts: { listenOnly?: boolean; skipModel?: boolean } = {}) {
    const items = latest.current.topic?.items;
    if (!items || idx < 0 || idx >= items.length) return;
    cancelAll();
    const run = runId.current;
    const item = items[idx];
    setIndex(idx);
    setResult(null);
    setTake(null);
    setNotice("");
    setError("");
    try {
      if (!opts.skipModel && !(await playModel(item, run))) return;
      if (opts.listenOnly) {
        setPhase("idle");
        return;
      }
      if (!isMine(item)) {
        // Partner's line in role mode: play it, then continue the dialogue.
        if (idx + 1 < items.length) runLine(idx + 1);
        else setPhase("idle");
        return;
      }
      await startRecording(item, idx, run);
    } catch (e) {
      if (run !== runId.current) return;
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra");
      setPhase("idle");
    }
  }

  async function startRecording(item: Item, idx: number, run: number) {
    if (!stream.current) {
      try {
        stream.current = await openMicrophone();
      } catch (e) {
        throw new Error(e instanceof DOMException ? "Không truy cập được micro. Hãy cho phép quyền ghi âm trong trình duyệt." : (e as Error).message);
      }
    }
    if (run !== runId.current) return;
    setLevel(0);
    setPhase("recording");
    recorder.current = new Recorder(stream.current, {
      onLevel: setLevel,
      onAutoStop: () => finishRecording(item, idx, run),
    });
  }

  async function finishRecording(item: Item, idx: number, run: number) {
    const rec = recorder.current;
    if (!rec || run !== runId.current) return;
    recorder.current = null;
    setPhase("assessing");
    try {
      const heard = rec.heardSpeech;
      const wav = await rec.stop();
      if (run !== runId.current) return;
      if (!heard) {
        setNotice("Không nghe thấy giọng của bạn. Hãy kiểm tra micro rồi thử lại. (Không gửi lên Azure, không tốn phí.)");
        setPhase("idle");
        return;
      }
      setTake(wav);
      const res = await api.assess(item.id, wav);
      if (run !== runId.current) return;
      setResult(res);
      setPhase("result");
      if (res.recording) {
        const saved = res.recording;
        setTopic((t) =>
          t && { ...t, items: t.items.map((it) => (it.id === item.id ? { ...it, recordings: [saved, ...it.recordings] } : it)) },
        );
      }
      if (res.usage && res.usage.costUsd > 0) refreshCosts();
      if (res.passed) recordSessionPass(item.id);
      const items = latest.current.topic!.items;
      if (res.passed && latest.current.prefs.autoAdvance && idx + 1 < items.length) {
        advanceTimer.current = window.setTimeout(() => run === runId.current && runLine(idx + 1), ADVANCE_DELAY_MS);
      }
    } catch (e) {
      if (run !== runId.current) return;
      setError(e instanceof Error ? e.message : "Không chấm được phát âm");
      setPhase("idle");
    }
  }

  /** Counts a completion once every line the learner speaks has passed in this session. */
  function recordSessionPass(itemId: number) {
    passedThisSession.current.add(itemId);
    const { topic } = latest.current;
    if (!topic || completedThisSession.current) return;
    const mine = topic.items.filter(isMine);
    if (mine.length > 0 && mine.every((it) => passedThisSession.current.has(it.id))) {
      completedThisSession.current = true;
      setCelebrate(true);
      api.completeTopic(topic.id).then((t) => setTopic((cur) => cur && { ...cur, completions: t.completions }), () => {});
    }
  }

  function stopEverything() {
    cancelAll();
    setPhase("idle");
    setProgress(0);
  }

  function selectLine(i: number) {
    stopEverything();
    setIndex(i);
    setResult(null);
    setTake(null);
    setNotice("");
    setError("");
  }

  function downloadTake() {
    if (!take || !topic) return;
    const base = topic.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "recording";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    saveBlob(take, `${base}-${String(index + 1).padStart(2, "0")}-${stamp}.wav`);
  }

  async function downloadAll() {
    try {
      await api.downloadTopicRecordings(topicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được");
    }
  }

  function playTake() {
    if (!take) return;
    playback.current?.stop();
    playback.current = playAudio(take);
  }

  // Keyboard: Space = start/stop, ←/→ = previous/next line, Esc = stop.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (mode === "write") return; // typing; Listen -> Write has its own keys
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (phase === "recording") finishRecording(topic!.items[index], index, runId.current);
      else if (phase === "idle" || phase === "result") runLine(index);
    } else if (e.code === "ArrowRight") runLine(index + 1);
    else if (e.code === "ArrowLeft") runLine(index - 1);
    else if (e.code === "Escape") stopEverything();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Keep the active line visible in the script.
  useEffect(() => {
    document.getElementById(`line-${index}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [index]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-red-600">{loadError}</p>
        <Link to="/topics" className="mt-4 inline-block text-indigo-600 hover:underline">
          ← Về danh sách topic
        </Link>
      </div>
    );
  }
  if (!topic) return <Spinner className="mx-auto mt-24" />;

  const items = topic.items;
  const item = items[index];
  const passedCount = items.filter((it) => it.recordings.length > 0).length;
  const speakerColor = (sp: string) => SPEAKER_COLORS[Math.max(0, topic.speakers.indexOf(sp)) % SPEAKER_COLORS.length];
  const meaningOf = (it: Item) => it.note || translations.get(it.text) || "";
  const mine = isMine(item);
  const busy = phase === "playing" || phase === "recording" || phase === "assessing";
  const generatedVoice = openaiTts;
  const totalCost = costs ? costs.reduce((sum, c) => sum + c.totalCostUsd, 0) : topic.totalCostUsd;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {topic.coverUrl && (
        // Soft, blurred cover behind the page: atmosphere without distraction.
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img src={topic.coverUrl} alt="" className="h-full w-full scale-110 object-cover opacity-[0.12] blur-3xl" />
        </div>
      )}
      <SelectionLookup language={topic.language} rate={prefs.rate} voiceURI={prefs.voice[topic.language] || undefined} topicId={topic.id} />

      {/* Header: title + one line of context; settings and extras tucked away */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={topic.isOwner ? "/topics" : "/public"} className="text-sm text-slate-400 hover:text-slate-700">
            ← {topic.isOwner ? "Topic của tôi" : "Topic công khai"}
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold sm:text-3xl">{topic.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {LANGUAGES[topic.language].flag} {topic.kind === "dialogue" ? "Hội thoại" : "Từ vựng"} ·{" "}
            <span className="text-emerald-600">
              {mode === "write" ? items.filter((it) => it.dictation?.passed).length : passedCount}/{items.length} câu đạt
            </span>
            {!topic.isOwner && <> · bởi {topic.ownerName}</>}
          </p>
          <div className="mt-3">
            <AvatarStack people={people} label="người đã luyện" size={24} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-6">
          <button
            onClick={() => setAddVocab(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-surface hover:ring-1 hover:ring-slate-200"
            title="Lưu từ vựng của topic này vào Pocket"
          >
            ＋ Từ vựng
          </button>
          <Popover label={<>⚙ {prefs.rate.toFixed(2)}×</>} title="Cài đặt luyện tập" width="w-80">
            <div className="space-y-4">
              <SpeedControl compact rate={prefs.rate} onChange={(rate) => setPrefs({ rate })} />
              {generatedVoice ? (
                <p className="text-slate-500">Giọng: OpenAI TTS (mỗi vai một giọng)</p>
              ) : (
                <VoiceSelect
                  language={topic.language}
                  value={prefs.voice[topic.language] ?? ""}
                  onChange={(v) => setPrefs({ voice: { ...prefs.voice, [topic.language]: v } })}
                />
              )}
              {topic.speakers.length > 1 && (
                <label className="flex items-center gap-2">
                  <span className="text-slate-500">Vai của bạn</span>
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-2 py-1">
                    <option value="">Tất cả các câu</option>
                    {topic.speakers.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={prefs.autoAdvance}
                  onChange={(e) => setPrefs({ autoAdvance: e.target.checked })}
                  className="h-4 w-4 accent-indigo-600"
                />
                <span className="text-slate-600">Tự chuyển câu khi đạt</span>
              </label>
              <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
                Bôi đen hoặc nhấp đúp vào từ để nghe lại, xem nghĩa, lưu vào Pocket.
                <br />
                Space: bắt đầu/dừng · ← →: đổi câu · Esc: dừng
              </p>
            </div>
          </Popover>
          <Popover label="⋯" title="Thêm" width="w-60">
            {(close) => (
              <div className="-m-2 flex flex-col">
                <button
                  onClick={() => {
                    close();
                    setAddToPlaylist(true);
                  }}
                  className="rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                >
                  ＋ Thêm vào playlist
                </button>
                {topic.isOwner && (
                  <Link to={`/topics/${topic.id}/edit`} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                    ✏️ Sửa nội dung
                  </Link>
                )}
                <button
                  disabled={passedCount === 0}
                  onClick={() => {
                    close();
                    downloadAll();
                  }}
                  className="rounded-lg px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40"
                >
                  ⬇ Tải tất cả bản ghi (.zip)
                </button>
                <div className="mt-1 border-t border-slate-100 px-3 pt-2 text-xs text-slate-400">
                  {topic.visibility === "public" ? "🌐 Công khai" : "🔒 Riêng tư"} · hoàn thành {topic.completions} lần · ≈ {formatUsd(totalCost)}
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {celebrate && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800 ring-1 ring-emerald-200">
          <span>🎉 Bạn đã đọc đạt mọi câu của topic này!</span>
          <button onClick={() => setCelebrate(false)} className="text-sm text-emerald-700 hover:underline">
            Đóng
          </button>
        </div>
      )}

      {/* Mode: speak along, or listen and write */}
      <div className="mt-6 inline-flex rounded-xl bg-surface p-1 ring-1 ring-slate-200">
        {(
          [
            ["shadow", "🗣 Shadowing"],
            ["write", "✍️ Nghe – Viết"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${mode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "shadow" && mock && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">Chế độ demo: điểm số là giả lập (chưa cấu hình Azure Speech).</p>}

      {mode === "write" ? (
        <Dictation
          topic={topic}
          play={playOnce}
          stop={() => playback.current?.stop()}
          rate={prefs.rate}
          speechStatus={speechStatus}
          meaningOf={meaningOf}
          onGraded={(itemId, best) => setTopic((t) => t && { ...t, items: t.items.map((it) => (it.id === itemId ? { ...it, dictation: best } : it)) })}
        />
      ) : (
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Stage */}
        <section className="lg:col-span-3">
          <div className="rounded-3xl bg-surface p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
            <div className="flex items-center justify-between text-sm text-slate-400">
              <span className="tabular-nums">
                {index + 1} / {items.length}
              </span>
              {item.speaker && (
                <span className={`font-semibold ${speakerColor(item.speaker)}`}>
                  {item.speaker}
                  {!mine && <span className="ml-1 font-normal text-slate-400">(nghe)</span>}
                </span>
              )}
            </div>

            {item.imageUrl && <img src={item.imageUrl} alt="" className="mt-6 max-h-64 w-full rounded-2xl object-cover" />}

            <p data-lookup data-sentence={item.text} data-image={item.imageKey} className="mt-6 min-h-[5rem] text-3xl font-medium leading-snug selection:bg-amber-200 sm:text-4xl">
              {phase === "result" && result ? (
                <AssessedText tokens={result.tokens} />
              ) : (
                <KaraokeText text={item.text} progress={progress} active={phase === "playing"} />
              )}
            </p>
            {meaningOf(item) && (
              <p className="mt-3 text-lg text-slate-400" title={item.note ? undefined : "Máy dịch"}>
                {meaningOf(item)}
              </p>
            )}

            {/* Controls: one obvious action per state */}
            <div className="mt-10">
              {phase === "idle" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => runLine(index)}
                    className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-500"
                  >
                    ▶ {mine ? "Nghe & đọc theo" : "Nghe câu này"}
                  </button>
                  {mine && (
                    <button onClick={() => runLine(index, { skipModel: true })} className={iconBtn} title="Đọc ngay, không nghe mẫu">
                      🎤
                    </button>
                  )}
                  <button onClick={() => runLine(index, { listenOnly: true })} className={iconBtn} title="Chỉ nghe mẫu">
                    🔊
                  </button>
                </div>
              )}

              {phase === "playing" && (
                <div className="flex items-center gap-3">
                  {speechStatus ? <Spinner className="h-6 w-6" /> : <span className="text-xl">🔊</span>}
                  <p className="flex-1 font-medium text-slate-600">
                    {speechStatus === "generating" ? "Generating…" : speechStatus === "loading" ? "Loading…" : mine ? "Nghe mẫu…" : "Nghe…"}
                  </p>
                  <button onClick={stopEverything} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                    Dừng
                  </button>
                </div>
              )}

              {phase === "recording" && (
                <div className="flex items-center gap-4">
                  <div className="relative flex h-12 w-12 items-center justify-center">
                    <span className="animate-pulse-ring absolute inset-0 rounded-full bg-red-400" />
                    <span
                      className="relative flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-xl text-white transition-transform"
                      style={{ transform: `scale(${1 + level * 0.25})` }}
                    >
                      🎤
                    </span>
                  </div>
                  <p className="flex-1 font-medium text-red-600">Đến lượt bạn</p>
                  <button
                    onClick={() => finishRecording(item, index, runId.current)}
                    className="rounded-xl bg-red-500 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
                  >
                    ■ Xong
                  </button>
                </div>
              )}

              {phase === "assessing" && (
                <div className="flex items-center gap-3">
                  <Spinner className="h-6 w-6" />
                  <p className="font-medium text-slate-600">Đang chấm…</p>
                </div>
              )}

              {phase === "result" && result && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${result.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {result.passed ? "✓ Đạt" : `Chưa đạt · cần ${result.threshold}`}
                    </span>
                    {result.passed && prefs.autoAdvance && index + 1 < items.length && <span className="text-sm text-slate-400">Sang câu tiếp…</span>}
                    <span className="ml-auto text-xs text-slate-400">{result.usage && <UsageNote usage={result.usage} />}</span>
                  </div>
                  <ScorePanel result={result} />
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => runLine(index, { skipModel: true })} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-500">
                      🎤 Đọc lại
                    </button>
                    <button onClick={() => runLine(index)} className={iconBtn} title="Nghe mẫu rồi đọc lại">
                      🔁
                    </button>
                    {take && (
                      <button onClick={playTake} className={iconBtn} title="Nghe giọng tôi">
                        ▶
                      </button>
                    )}
                    {take && (
                      <button onClick={downloadTake} className={iconBtn} title="Tải bản ghi này">
                        ⬇
                      </button>
                    )}
                    {index + 1 < items.length && (
                      <button onClick={() => runLine(index + 1)} className="ml-auto rounded-xl px-4 py-2.5 font-medium text-indigo-700 hover:bg-indigo-50">
                        Câu tiếp →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {notice && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
              {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            </div>
          </div>

          <div className="mt-3 flex justify-between">
            <button disabled={index === 0} onClick={() => runLine(index - 1)} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-700 disabled:opacity-30">
              ← Câu trước
            </button>
            <button
              disabled={index + 1 >= items.length}
              onClick={() => runLine(index + 1)}
              className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-700 disabled:opacity-30"
            >
              Câu sau →
            </button>
          </div>

          {/* Secondary information, collapsed by default */}
          <div className="mt-4 space-y-3">
            <Section
              title={`Bản ghi đạt của câu này (${item.recordings.length})`}
              aside={item.recordings.length > 0 ? `≈ ${formatUsd(item.recordings.reduce((s, r) => s + r.costUsd, 0))}` : undefined}
            >
              <RecordingList
                recordings={item.recordings}
                threshold={threshold}
                onDeleted={(id) =>
                  setTopic((t) => t && { ...t, items: t.items.map((it) => ({ ...it, recordings: it.recordings.filter((r) => r.id !== id) })) })
                }
              />
            </Section>
            <Section title="Chi phí của topic" aside={`≈ ${formatUsd(totalCost)}`}>
              <CostTable costs={costs} />
            </Section>
          </div>
        </section>

        {/* Script with Vietnamese meanings */}
        <aside className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl bg-surface p-3 ring-1 ring-slate-200">
            <h2 className="px-2 pb-2 pt-1 text-sm font-semibold text-slate-400">Kịch bản</h2>
            {translateError && <p className="mx-2 mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Không tải được bản dịch: {translateError}</p>}
            <ol className="max-h-[70vh] space-y-0.5 overflow-y-auto">
              {items.map((it, i) => (
                <li key={it.id} id={`line-${i}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-disabled={busy && i === index}
                    onClick={() => {
                      if (window.getSelection()?.toString()) return; // the user is selecting text, not jumping
                      if (!(busy && i === index)) selectLine(i);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && selectLine(i)}
                    className={`flex w-full cursor-pointer gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                      i === index ? "bg-indigo-50" : "hover:bg-slate-50"
                    } ${role && it.speaker !== role ? "opacity-50" : ""}`}
                  >
                    <span className={`mt-0.5 w-4 shrink-0 text-center ${it.recordings.length ? "text-emerald-500" : "text-slate-200"}`}>
                      {it.recordings.length ? "✓" : "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span data-lookup data-sentence={it.text} data-image={it.imageKey} className="selection:bg-amber-200">
                        {it.speaker && <span className={`font-semibold ${speakerColor(it.speaker)}`}>{it.speaker}: </span>}
                        <span className={i === index ? "text-slate-900" : "text-slate-600"}>{it.text}</span>
                      </span>
                      {meaningOf(it) && <span className="mt-0.5 block text-xs text-slate-400">{meaningOf(it)}</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
      )}

      {addToPlaylist && <AddToPlaylistDialog topicId={topic.id} open onClose={() => setAddToPlaylist(false)} />}
      {addVocab && <AddVocabDialog topic={topic} onClose={() => setAddVocab(false)} />}
    </div>
  );
}

/** Collapsible secondary block (closed by default). */
function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl bg-surface ring-1 ring-slate-200">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
        <span className="text-slate-300 transition-transform group-open:rotate-90">▸</span>
        <span className="flex-1">{title}</span>
        {aside && <span className="text-xs tabular-nums text-slate-400">{aside}</span>}
      </summary>
      <div className="px-5 pb-4">{children}</div>
    </details>
  );
}

function CostTable({ costs }: { costs: TopicCost[] | null }) {
  if (costs === null) return <Spinner />;
  if (costs.length === 0) return <p className="text-sm text-slate-400">Chưa phát sinh chi phí.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-400">
          <tr>
            <th className="py-1 font-medium">Người dùng</th>
            <th className="py-1 text-right font-medium">Chấm điểm</th>
            <th className="py-1 text-right font-medium">Kịch bản AI</th>
            <th className="py-1 text-right font-medium">Giọng đọc AI</th>
            <th className="py-1 text-right font-medium">Tổng</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => (
            <tr key={c.userId} className="border-t border-slate-100 tabular-nums">
              <td className="py-1.5 font-medium">{c.name}</td>
              <td className="py-1.5 text-right">
                {formatUsd(c.gradingCostUsd)} <span className="text-xs text-slate-400">({c.gradings})</span>
              </td>
              <td className="py-1.5 text-right">{formatUsd(c.scriptCostUsd)}</td>
              <td className="py-1.5 text-right">{formatUsd(c.ttsCostUsd)}</td>
              <td className="py-1.5 text-right font-semibold">{formatUsd(c.totalCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
