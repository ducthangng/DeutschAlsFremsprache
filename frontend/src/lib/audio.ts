// Audio helpers: microphone recording -> 16 kHz mono WAV (the format Azure
// Pronunciation Assessment expects), cancellable playback, and the browser's
// speech engine for the reference voice (with progress for karaoke highlighting).

const TARGET_RATE = 16000;

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). Every iOS browser is WebKit. */
export const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// ---- iOS audio unlocking ----
// iOS only lets a page make sound (HTMLAudio.play, a running AudioContext,
// speechSynthesis) when it starts inside a user gesture. Practice plays the
// reference audio *after* awaiting the network and records after playback, so
// one shared AudioContext and one shared <audio> element are unlocked on the
// first tap and reused for everything afterwards.

type AudioContextCtor = typeof AudioContext;
let sharedCtx: AudioContext | null = null;

/** The page's single AudioContext (iOS allows only a few, and each must be unlocked). */
export function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    const Ctor: AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

let sharedPlayer: HTMLAudioElement | null = null;
function player(): HTMLAudioElement {
  if (!sharedPlayer) {
    sharedPlayer = new Audio();
    sharedPlayer.setAttribute("playsinline", "");
    sharedPlayer.preload = "auto";
  }
  return sharedPlayer;
}

const SILENT_WAV = "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 10 ms of silence
let unlocked = false;

function unlockAudio() {
  try {
    const ctx = audioContext();
    // iOS also suspends ("interrupted") the context after calls, Siri, lock screen…
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    if (unlocked) return;
    unlocked = true;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    if (!currentPlayback) {
      const p = player();
      p.src = SILENT_WAV;
      void p.play().catch(() => {});
    }
    if ("speechSynthesis" in window && !speechSynthesis.speaking && !speechSynthesis.pending) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* best effort */
  }
}

if (typeof window !== "undefined") {
  for (const ev of ["touchend", "pointerup", "click", "keydown"]) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
}

/** Safari 17+: tell iOS whether we record or only play (affects routing and the silent switch). */
function setAudioSession(type: "play-and-record" | "playback" | "auto") {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = type;
    } catch {
      /* unsupported value */
    }
  }
}

export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Trình duyệt không hỗ trợ ghi âm (cần HTTPS hoặc localhost).");
  }
  setAudioSession("play-and-record");
  return navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/** True while the stream still has a live, enabled audio track. */
export function isLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);
}

// Safari records AAC in MP4 natively; its WebM support is recent and its decoder is not.
const PREFERRED_TYPES = IS_IOS || /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
  ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
  : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

function closeStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Friendly message for microphone failures. */
export function micErrorMessage(e: unknown): string {
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
    return IS_IOS
      ? "Không truy cập được micro. Trên iPhone: bấm \"ᴀA\" (Safari) trên thanh địa chỉ → Cài đặt trang web → Micro → Cho phép, hoặc Cài đặt → Chrome → bật Micro."
      : "Không truy cập được micro. Hãy cho phép quyền ghi âm trong trình duyệt.";
  }
  if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) {
    return "Không tìm thấy micro. Hãy cắm micro hoặc chọn thiết bị ghi âm khác.";
  }
  if (e instanceof DOMException && e.name === "NotReadableError") {
    return "Micro đang bị ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.";
  }
  return e instanceof Error ? e.message : "Không bật được ghi âm.";
}

/**
 * Starts a Recorder on the cached microphone stream. The stream is reopened
 * when it has ended (microphone unplugged or switched, sleep, permission
 * change, or released after the previous take on iOS), and once more if the
 * browser refuses to record from it.
 */
export async function startRecorder(streamRef: { current: MediaStream | null }, opts: RecorderOptions): Promise<Recorder> {
  if (!isLive(streamRef.current)) {
    closeStream(streamRef.current);
    streamRef.current = await openMicrophone();
  }
  try {
    return new Recorder(streamRef.current!, opts);
  } catch {
    closeStream(streamRef.current);
    streamRef.current = await openMicrophone();
    try {
      return new Recorder(streamRef.current, opts);
    } catch (e) {
      closeStream(streamRef.current);
      streamRef.current = null;
      console.error("Recorder failed twice", e);
      throw new Error("Không bật được ghi âm. Hãy kiểm tra micro (có đang bị ứng dụng khác dùng không?) rồi tải lại trang.");
    }
  }
}

export interface RecorderOptions {
  /** Called ~60x/s with input level 0..1. */
  onLevel?: (level: number) => void;
  /** Called when the recorder decides to stop by itself (silence / max length). */
  onAutoStop?: () => void;
  /** Silence after speech that ends the take. */
  silenceMs?: number;
  /** Give up if nothing is said within this time. */
  noSpeechMs?: number;
  maxMs?: number;
}

/**
 * Records one take. Raw PCM is captured straight from the shared AudioContext
 * (no codec involved, so it works the same on iOS); MediaRecorder runs alongside
 * as a fallback for when the context could not run.
 */
export class Recorder {
  private chunks: Blob[] = [];
  private media: MediaRecorder | null = null;
  private stopped: Promise<Blob | null>;
  private ctx: AudioContext;
  private nodes: AudioNode[] = [];
  private pcm: Float32Array[] = [];
  private raf = 0;
  private autoStopped = false;
  private heard = false;
  /** Whether the level meter ever got real input (the context was running). */
  private measured = false;
  private done = false;

  /** Throws if the browser cannot record from this stream (see startRecorder). */
  constructor(private stream: MediaStream, private opts: RecorderOptions = {}) {
    if (typeof MediaRecorder !== "undefined") {
      const mimeType = pickMimeType();
      const media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      media.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
      this.stopped = new Promise((resolve) => {
        media.onstop = () => resolve(new Blob(this.chunks, { type: media.mimeType }));
      });
      // No timeslice: Safari's fragmented MP4 chunks are not always decodable.
      media.start();
      this.media = media;
    } else {
      this.stopped = Promise.resolve(null);
    }
    this.ctx = audioContext();
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    // ScriptProcessor is deprecated but is the one PCM tap every browser (incl. old iOS) has.
    const tap = this.ctx.createScriptProcessor(4096, 1, 1);
    tap.onaudioprocess = (e) => {
      if (!this.done) this.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap);
    tap.connect(mute);
    mute.connect(this.ctx.destination); // processors only run when connected to the output
    this.nodes = [source, analyser, tap, mute];
    this.monitor(analyser);
  }

  private monitor(analyser: AnalyserNode) {
    const { silenceMs = 1400, noSpeechMs = 8000, maxMs = 30000 } = this.opts;
    const buf = new Float32Array(analyser.fftSize);
    let start = performance.now();
    let lastLoud = start;
    // Adaptive noise floor: first ~300 ms of real input establish ambient level.
    let floor = 0.01;
    let measuredAt = 0;
    const began = start;
    const tick = () => {
      const now = performance.now();
      if (now - began > maxMs) return this.autoStop();
      if (this.ctx.state !== "running") {
        // Cannot measure (iOS kept the context suspended): no silence detection,
        // the learner taps "Xong" themselves.
        this.raf = requestAnimationFrame(tick);
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      if (!this.measured) {
        this.measured = true;
        measuredAt = start = lastLoud = now;
      }
      if (now - measuredAt < 300) floor = Math.max(floor, rms * 1.5);
      this.opts.onLevel?.(Math.min(1, rms * 8));
      if (rms > Math.max(0.02, floor * 2)) {
        this.heard = true;
        lastLoud = now;
      }
      if ((this.heard && now - lastLoud > silenceMs) || (!this.heard && now - start > noSpeechMs)) return this.autoStop();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private autoStop() {
    this.autoStopped = true;
    this.opts.onAutoStop?.();
  }

  get stoppedAutomatically() {
    return this.autoStopped;
  }

  /** Whether anything louder than the ambient noise was captured (true when it could not be measured). */
  get heardSpeech() {
    return this.heard || !this.measured;
  }

  private teardown() {
    this.done = true;
    cancelAnimationFrame(this.raf);
    if (this.media && this.media.state !== "inactive") this.media.stop();
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    if (IS_IOS) {
      // While the microphone is open iOS routes sound to the quiet earpiece:
      // release it so the next reference audio plays on the loudspeaker.
      closeStream(this.stream);
      setAudioSession("playback");
    }
  }

  /** Stops recording and returns the take as 16 kHz mono 16-bit WAV. */
  async stop(): Promise<Blob> {
    const rate = this.ctx.sampleRate;
    this.teardown();
    const length = this.pcm.reduce((n, c) => n + c.length, 0);
    if (length > rate * 0.2) {
      const buf = this.ctx.createBuffer(1, length, rate);
      const data = buf.getChannelData(0);
      let off = 0;
      for (const c of this.pcm) {
        data.set(c, off);
        off += c.length;
      }
      this.pcm = [];
      return encodeWAV(await resample(buf));
    }
    const blob = await this.stopped;
    if (!blob || blob.size === 0) throw new Error("Không ghi được âm thanh. Hãy thử lại.");
    const decoded = await decode(this.ctx, await blob.arrayBuffer());
    return encodeWAV(await resample(decoded));
  }

  cancel() {
    this.teardown();
    this.pcm = [];
  }
}

/** decodeAudioData, also in the callback form older Safari requires. */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, () => reject(new Error("Không đọc được bản ghi âm. Hãy thử lại.")));
    p?.catch?.(() => {});
  });
}

async function resample(buf: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buf.duration * TARGET_RATE));
  const off = new OfflineAudioContext(1, length, TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = buf; // multi-channel input is down-mixed to the mono destination
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

function encodeWAV(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off: number, s: string) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// ---- playback ----

export interface Playback {
  done: Promise<void>;
  stop: () => void;
}

export interface PlayOptions {
  /** Playback speed (pitch is preserved). */
  rate?: number;
  onProgress?: (p: number) => void;
  /** Called once enough audio has arrived to start playing. */
  onStart?: () => void;
}

/** The playback currently using the shared <audio> element. */
let currentPlayback: { finish: () => void } | null = null;

/**
 * Plays a blob or URL; resolves when playback ends or is stopped. All playback
 * goes through one <audio> element that was unlocked by the first tap, so it
 * may start after an await (iOS refuses play() on a fresh element there).
 */
export function playAudio(src: Blob | string, { rate = 1, onProgress, onStart }: PlayOptions = {}): Playback {
  currentPlayback?.finish(); // whatever played before ends as if stopped
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const audio = player();
  let raf = 0;
  let settled = false;
  let resolveDone: () => void = () => {};
  let rejectDone: (e: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const cleanup = () => {
    settled = true;
    cancelAnimationFrame(raf);
    if (typeof src !== "string") URL.revokeObjectURL(url);
    if (currentPlayback === me) currentPlayback = null;
  };
  const me = {
    finish: () => {
      if (settled) return;
      cleanup();
      resolveDone();
    },
  };
  currentPlayback = me;
  const tick = () => {
    if (audio.duration > 0 && isFinite(audio.duration)) onProgress?.(audio.currentTime / audio.duration);
    raf = requestAnimationFrame(tick);
  };
  audio.onended = () => {
    if (currentPlayback !== me) return;
    onProgress?.(1);
    me.finish();
  };
  audio.onerror = () => {
    if (currentPlayback !== me || settled) return;
    cleanup();
    rejectDone(new Error("Không phát được âm thanh"));
  };
  audio.onplaying = () => {
    if (currentPlayback !== me) return;
    audio.playbackRate = rate; // Safari resets the rate when a new source loads
    onStart?.();
  };
  audio.src = url;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  audio.play().then(
    () => {
      if (currentPlayback === me) raf = requestAnimationFrame(tick);
    },
    (e: unknown) => {
      if (currentPlayback !== me || settled) return;
      cleanup();
      // AbortError: replaced by another source; NotAllowedError: blocked by autoplay rules.
      if (e instanceof DOMException && e.name === "NotAllowedError") rejectDone(new Error("Trình duyệt chặn phát âm thanh. Hãy chạm vào nút phát lại."));
      else resolveDone();
    },
  );
  return {
    done,
    stop: () => {
      if (currentPlayback === me) audio.pause();
      me.finish();
    },
  };
}

/** Voices the browser offers for a language ("de-DE" also matches "de-AT", …), best first. */
export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  const prefix = lang.slice(0, 2).toLowerCase();
  const quality = (v: SpeechSynthesisVoice) =>
    (v.lang.replace("_", "-") === lang ? 4 : 0) + (/natural|neural|premium|enhanced|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix))
    .sort((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name));
}

/** Calls fn now and whenever the browser's voice list changes (voices load asynchronously). */
export function onVoicesChanged(fn: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => {};
  fn();
  speechSynthesis.addEventListener("voiceschanged", fn);
  return () => speechSynthesis.removeEventListener("voiceschanged", fn);
}

export interface SpeakOptions {
  lang: string;
  /** 0.5 (slow) .. 1.5 (fast); 1 is the voice's normal pace. */
  rate: number;
  /** voiceURI of a specific voice; falls back to the best voice for lang. */
  voiceURI?: string;
  onProgress?: (p: number) => void;
}

/** Speaks text with the browser's speech engine. */
export function speak(text: string, { lang, rate, voiceURI, onProgress }: SpeakOptions): Playback {
  if (!("speechSynthesis" in window)) {
    return { done: Promise.reject(new Error("Trình duyệt không hỗ trợ đọc văn bản")), stop: () => {} };
  }
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voices = voicesFor(lang);
  const voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0];
  if (voice) u.voice = voice;
  // Estimate progress by time; refine with word boundary events when available.
  const estMs = (text.length * 70) / rate;
  const start = performance.now();
  let raf = 0;
  let boundary = 0;
  const tick = () => {
    onProgress?.(Math.min(0.98, Math.max(boundary, (performance.now() - start) / estMs)));
    raf = requestAnimationFrame(tick);
  };
  u.onboundary = (e) => (boundary = e.charIndex / text.length);
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = () => {
      cancelAnimationFrame(raf);
      onProgress?.(1);
      resolve();
    };
    u.onend = u.onerror = () => finish();
  });
  // iOS sometimes never starts (or never ends) an utterance; don't hang the practice flow.
  let started = false;
  u.onstart = () => (started = true);
  const noStart = window.setTimeout(() => !started && finish(), 3000);
  const tooLong = window.setTimeout(() => finish(), estMs * 2.5 + 5000);
  void done.then(() => {
    clearTimeout(noStart);
    clearTimeout(tooLong);
  });
  speechSynthesis.speak(u);
  // Safari can stay paused after an interruption.
  if (speechSynthesis.paused) speechSynthesis.resume();
  raf = requestAnimationFrame(tick);
  return {
    done,
    stop: () => {
      speechSynthesis.cancel();
      finish();
    },
  };
}
