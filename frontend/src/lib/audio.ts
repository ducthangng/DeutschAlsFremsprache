// Audio helpers: microphone recording -> 16 kHz mono WAV (the format Azure
// Pronunciation Assessment expects), cancellable playback, and the browser's
// speech engine for the reference voice (with progress for karaoke highlighting).

const TARGET_RATE = 16000;

export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Trình duyệt không hỗ trợ ghi âm (cần HTTPS hoặc localhost).");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/** True while the stream still has a live, enabled audio track. */
export function isLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);
}

const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

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
    return "Không truy cập được micro. Hãy cho phép quyền ghi âm trong trình duyệt.";
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
 * change), and once more if the browser refuses to record from it
 * ("There was an error starting the MediaRecorder").
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
      console.error("MediaRecorder failed twice", e);
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

export class Recorder {
  private chunks: Blob[] = [];
  private media: MediaRecorder;
  private ctx: AudioContext;
  private raf = 0;
  private stopped: Promise<Blob>;
  private autoStopped = false;
  private heard = false;

  /** Throws if the browser cannot record from this stream (see startRecorder). */
  constructor(stream: MediaStream, private opts: RecorderOptions = {}) {
    const mimeType = pickMimeType();
    this.media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.media.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.stopped = new Promise((resolve) => {
      this.media.onstop = () => resolve(new Blob(this.chunks, { type: this.media.mimeType }));
    });
    // Start first: if the browser refuses, nothing else has been set up yet.
    this.media.start(250);
    this.ctx = new AudioContext();
    void this.ctx.resume();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(stream).connect(analyser);
    this.monitor(analyser);
  }

  private monitor(analyser: AnalyserNode) {
    const { silenceMs = 1400, noSpeechMs = 8000, maxMs = 30000 } = this.opts;
    const buf = new Float32Array(analyser.fftSize);
    const start = performance.now();
    let heard = false;
    let lastLoud = start;
    // Adaptive noise floor: first ~300 ms establish ambient level.
    let floor = 0.01;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (now - start < 300) floor = Math.max(floor, rms * 1.5);
      this.opts.onLevel?.(Math.min(1, rms * 8));
      if (rms > Math.max(0.02, floor * 2)) {
        heard = this.heard = true;
        lastLoud = now;
      }
      const elapsed = now - start;
      if ((heard && now - lastLoud > silenceMs) || (!heard && elapsed > noSpeechMs) || elapsed > maxMs) {
        this.autoStopped = true;
        this.opts.onAutoStop?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  get stoppedAutomatically() {
    return this.autoStopped;
  }

  /** Whether anything louder than the ambient noise was captured. */
  get heardSpeech() {
    return this.heard;
  }

  /** Stops recording and returns the take as 16 kHz mono 16-bit WAV. */
  async stop(): Promise<Blob> {
    cancelAnimationFrame(this.raf);
    if (this.media.state !== "inactive") this.media.stop();
    const blob = await this.stopped;
    try {
      const decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      return encodeWAV(await resample(decoded));
    } finally {
      this.ctx.close();
    }
  }

  cancel() {
    cancelAnimationFrame(this.raf);
    if (this.media.state !== "inactive") this.media.stop();
    this.ctx.close();
  }
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

/** Plays a blob or URL; resolves when playback ends or is stopped. */
export function playAudio(src: Blob | string, { rate = 1, onProgress, onStart }: PlayOptions = {}): Playback {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const release = () => typeof src !== "string" && URL.revokeObjectURL(url);
  const audio = new Audio(url);
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  let raf = 0;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = () => {
      cancelAnimationFrame(raf);
      release();
      resolve();
    };
    audio.onended = () => {
      onProgress?.(1);
      finish();
    };
    audio.onerror = () => {
      cancelAnimationFrame(raf);
      release();
      reject(new Error("Không phát được âm thanh"));
    };
  });
  const tick = () => {
    if (audio.duration > 0) onProgress?.(audio.currentTime / audio.duration);
    raf = requestAnimationFrame(tick);
  };
  audio.onplaying = () => onStart?.();
  audio.play().then(() => (raf = requestAnimationFrame(tick)), () => finish());
  return {
    done,
    stop: () => {
      audio.pause();
      finish();
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
  speechSynthesis.cancel();
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
  speechSynthesis.speak(u);
  raf = requestAnimationFrame(tick);
  return {
    done,
    stop: () => {
      speechSynthesis.cancel();
      finish();
    },
  };
}
