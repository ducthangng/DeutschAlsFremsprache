import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ImagePicker from "../components/ImagePicker";
import Spinner from "../components/Spinner";
import { api, LANGUAGES, type GenerateResult, type Language, type SentenceLength, type SpeechType, type TopicInput, type TopicKind, type Visibility } from "../lib/api";
import { formatUsd } from "../lib/format";
import { useDialog } from "../components/Dialog";

const EXAMPLES: Record<TopicKind, Record<Language, string>> = {
  dialogue: {
    "de-DE": `Anna: Entschuldigung, wo ist Gleis drei? | Xin lỗi, sân ga số 3 ở đâu?
Bahnmitarbeiter: Gehen Sie geradeaus und dann links. | Đi thẳng rồi rẽ trái.
Anna: Fährt der Zug nach München pünktlich ab?
Bahnmitarbeiter: Nein, er hat leider zehn Minuten Verspätung.
Anna: Vielen Dank für Ihre Hilfe!`,
    "en-US": `Interviewer: Tell me a little bit about yourself.
Candidate: I'm a software engineer with five years of experience.
Interviewer: Why do you want to work here?
Candidate: I really admire the products your team builds.`,
  },
  vocabulary: {
    "de-DE": `der Bahnhof | nhà ga
die Fahrkarte | vé tàu
die Verspätung | sự chậm trễ
umsteigen | đổi tàu
Ich hätte gern eine Fahrkarte nach Berlin.`,
    "en-US": `appointment | cuộc hẹn
prescription | đơn thuốc
I'd like to make an appointment.
thoroughly
comfortable`,
  },
};

const SPEECH_TYPES: { value: SpeechType; label: string; hint: string }[] = [
  { value: "dialogue", label: "💬 Hội thoại 2 người", hint: "Hai nhân vật nói qua lại" },
  { value: "monologue", label: "🎙️ Độc thoại", hint: "Một người kể, thông báo, giải thích" },
  { value: "vocabulary", label: "📚 Từ vựng", hint: "Từ và câu ví dụ ngắn" },
];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SENTENCE_LENGTHS: { value: SentenceLength; label: string; hint: string }[] = [
  { value: "short", label: "Ngắn", hint: "3–7 từ" },
  { value: "medium", label: "Vừa", hint: "8–14 từ" },
  { value: "long", label: "Dài", hint: "15–25 từ" },
];

// Mirrors the backend parser so the preview matches what will be saved.
function preview(kind: TopicKind, content: string) {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((raw) => {
      let note = "";
      let speaker = "";
      const bar = raw.indexOf("|");
      if (bar >= 0) {
        note = raw.slice(bar + 1).trim();
        raw = raw.slice(0, bar).trim();
      }
      if (kind === "dialogue") {
        const i = (raw + " ").indexOf(": ");
        const sp = i >= 0 ? raw.slice(0, i).trim() : "";
        if (sp && [...sp].length <= 24 && !/[.?!,]/.test(sp)) {
          speaker = sp;
          raw = raw.slice(i + 1).trim();
        }
      }
      return { speaker, text: raw, note };
    })
    .filter((l) => l.text);
}

function splitVocabulary(s: string): string[] {
  return s
    .split(/[\n;,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const seg = (active: boolean) =>
  `flex-1 rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-surface text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`;

export default function TopicForm() {
  const { id } = useParams();
  const editing = id !== undefined;
  const navigate = useNavigate();
  const dialog = useDialog();
  const [form, setForm] = useState<TopicInput>({ title: "", description: "", language: "de-DE", kind: "dialogue", visibility: "private", content: "" });
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // AI generation
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [scenario, setScenario] = useState("");
  const [vocabText, setVocabText] = useState("");
  const [speechType, setSpeechType] = useState<SpeechType>("dialogue");
  const [level, setLevel] = useState("A2");
  const [lineCount, setLineCount] = useState(10);
  const [sentenceLength, setSentenceLength] = useState<SentenceLength>("medium");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [generation, setGeneration] = useState<GenerateResult | null>(null);
  const [generationIds, setGenerationIds] = useState<number[]>([]);
  const [spent, setSpent] = useState(0);
  const [pocketPicks, setPocketPicks] = useState<Set<string>>(new Set());

  // Pictures: a cover, and one per line keyed by "speaker|text" so they follow the line through edits.
  const [cover, setCover] = useState({ key: "", url: "" });
  const [lineImages, setLineImages] = useState<Map<string, { key: string; url: string }>>(new Map());
  const lineKey = (l: { speaker: string; text: string }) => `${l.speaker}|${l.text}`;

  useEffect(() => {
    api.health().then((h) => setAiEnabled(h.openaiScript), () => setAiEnabled(false));
    if (!editing) return;
    api
      .getTopic(Number(id))
      .then((t) => {
        setForm({ title: t.title, description: t.description, language: t.language, kind: t.kind, visibility: t.visibility, content: t.content });
        setCover({ key: t.coverKey, url: t.coverUrl });
        setLineImages(new Map(t.items.filter((it) => it.imageKey).map((it) => [lineKey(it), { key: it.imageKey, url: it.imageUrl }])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editing, id]);

  const lines = useMemo(() => preview(form.kind, form.content), [form.kind, form.content]);
  const set = <K extends keyof TopicInput>(k: K, v: TopicInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function generate() {
    if (
      form.content.trim() &&
      !generation &&
      !(await dialog.confirm({ title: "Thay nội dung hiện tại?", message: "Nội dung bạn đã nhập sẽ được thay bằng nội dung do AI tạo.", confirmText: "Tạo bằng AI" }))
    )
      return;
    setGenerating(true);
    setGenError("");
    try {
      const res = await api.generateScript({
        language: form.language,
        speechType,
        scenario,
        vocabulary: splitVocabulary(vocabText),
        level,
        lines: lineCount,
        length: sentenceLength,
      });
      setGeneration(res);
      if (res.generationId) setGenerationIds((ids) => [...ids, res.generationId]);
      setSpent((s) => s + res.usage.costUsd);
      setPocketPicks(new Set(res.vocabulary.map((v) => v.term)));
      setForm((f) => ({ ...f, title: res.title, description: res.description, kind: res.kind, content: res.content }));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Không tạo được nội dung");
    } finally {
      setGenerating(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pictures = { coverKey: cover.key, images: lines.map((l) => lineImages.get(lineKey(l))?.key ?? "") };
    setBusy(true);
    setError("");
    try {
      const t = editing
        ? await api.updateTopic(Number(id), { ...form, ...pictures })
        : await api.createTopic({
            ...form,
            ...pictures,
            generationIds,
            vocabulary: generation?.vocabulary.filter((v) => pocketPicks.has(v.term)) ?? [],
          });
      navigate(`/topics/${t.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được");
      setBusy(false);
    }
  }

  if (loading) return <Spinner className="mx-auto mt-24" />;

  const aiPanel = (
    <aside className="lg:col-span-2">
      <div className="space-y-4 rounded-2xl bg-gradient-to-b from-indigo-50 to-surface p-5 ring-1 ring-indigo-100 lg:sticky lg:top-20">
        <div>
          <h2 className="font-semibold">✨ Tạo bằng AI</h2>
          <p className="mt-0.5 text-xs text-slate-500">Mô tả tình huống và từ vựng cần học, AI sẽ viết nội dung kèm nghĩa tiếng Việt. Bạn xem lại và sửa trước khi tạo topic.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(Object.keys(LANGUAGES) as Language[]).map((l) => (
            <button type="button" key={l} className={seg(form.language === l)} onClick={() => set("language", l)}>
              {LANGUAGES[l].flag} {LANGUAGES[l].label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Chủ đề / tình huống</span>
          <textarea
            className={`${input} h-20 text-sm`}
            maxLength={500}
            placeholder="VD: Mua vé tàu ở nhà ga, hỏi giờ khởi hành và sân ga"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Từ vựng mới cần dùng</span>
          <textarea
            className={`${input} h-24 font-mono text-sm`}
            placeholder={form.language === "de-DE" ? "die Fahrkarte\ndie Verspätung\numsteigen" : "boarding pass\ndelay\nto transfer"}
            value={vocabText}
            onChange={(e) => setVocabText(e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-400">Mỗi dòng một từ (hoặc cách nhau bằng dấu phẩy). Các từ này sẽ xuất hiện trong nội dung.</span>
        </label>
        <div>
          <span className="mb-1 block text-sm font-medium">Loại nội dung</span>
          <div className="grid gap-1.5">
            {SPEECH_TYPES.map((t) => (
              <label
                key={t.value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${
                  speechType === t.value ? "bg-surface ring-indigo-300" : "ring-slate-200 hover:bg-surface"
                }`}
              >
                <input type="radio" name="speechType" checked={speechType === t.value} onChange={() => setSpeechType(t.value)} className="accent-indigo-600" />
                <span className="font-medium">{t.label}</span>
                <span className="text-xs text-slate-400">{t.hint}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Trình độ</span>
            <select className={input} value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Số câu</span>
            <input className={input} type="number" min={4} max={30} value={lineCount} onChange={(e) => setLineCount(Math.min(30, Math.max(4, Number(e.target.value) || 4)))} />
          </label>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">Độ dài câu</span>
          <div className="grid grid-cols-3 gap-2">
            {SENTENCE_LENGTHS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setSentenceLength(l.value)}
                className={`rounded-xl px-3 py-2 text-left text-sm ring-1 transition ${
                  sentenceLength === l.value ? "bg-surface ring-indigo-300" : "ring-slate-200 hover:bg-surface"
                }`}
              >
                <span className="block font-medium">{l.label}</span>
                <span className="text-xs text-slate-400">{l.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={!aiEnabled || generating || !scenario.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? (
            <>
              <Spinner className="h-4 w-4 border-indigo-300 border-t-white" /> Đang tạo…
            </>
          ) : generation ? (
            "🔄 Tạo lại"
          ) : (
            "✨ Generate"
          )}
        </button>
        {aiEnabled === false && <p className="text-xs text-amber-700">Máy chủ chưa cấu hình <code>OPENAI_API_KEY</code>, nên chưa dùng được tính năng này.</p>}
        {genError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{genError}</p>}
        {generation && (
          <p className="text-xs text-slate-500">
            {generation.usage.model} · {(generation.usage.inputTokens + generation.usage.outputTokens).toLocaleString("vi-VN")} tokens · ≈{" "}
            {formatUsd(generation.usage.costUsd)}
            {generationIds.length > 1 && <> · tổng {generationIds.length} lần tạo ≈ {formatUsd(spent)}</>}
          </p>
        )}
      </div>
    </aside>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to={editing ? `/topics/${id}` : "/topics"} className="text-sm text-slate-500 hover:text-slate-800">
        ← Quay lại
      </Link>
      <h1 className="mt-2 text-3xl font-bold">{editing ? "Sửa topic" : "Tạo topic mới"}</h1>

      <div className={`mt-8 grid gap-8 ${editing ? "" : "lg:grid-cols-5"}`}>
        {!editing && aiPanel}

        <form onSubmit={submit} className="space-y-5 lg:col-span-3">
          {generation && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
              ✨ Nội dung do AI tạo. Hãy xem lại và sửa nếu cần, rồi bấm <b>Tạo topic</b>.
            </p>
          )}
          <div>
            <span className="mb-1 block text-sm font-medium">Ảnh bìa</span>
            <div className="max-w-md">
              <ImagePicker url={cover.url} onChange={(key, url) => setCover({ key, url })} />
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Tên tình huống</span>
            <input className={input} required maxLength={120} placeholder="VD: Am Bahnhof" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Mô tả (tuỳ chọn)</span>
            <input className={input} placeholder="Hỏi đường tới sân ga, mua vé…" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {editing && (
              <div>
                <span className="mb-1 block text-sm font-medium">Ngôn ngữ</span>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  {(Object.keys(LANGUAGES) as Language[]).map((l) => (
                    <button type="button" key={l} className={seg(form.language === l)} onClick={() => set("language", l)}>
                      {LANGUAGES[l].flag} {LANGUAGES[l].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="mb-1 block text-sm font-medium">Loại topic</span>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                <button type="button" className={seg(form.kind === "dialogue")} onClick={() => set("kind", "dialogue")}>
                  💬 Hội thoại
                </button>
                <button type="button" className={seg(form.kind === "vocabulary")} onClick={() => set("kind", "vocabulary")}>
                  📚 Từ vựng
                </button>
              </div>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium">Trạng thái</span>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {(["private", "public"] as Visibility[]).map((v) => (
                  <button type="button" key={v} className={seg(form.visibility === v)} onClick={() => set("visibility", v)}>
                    {v === "private" ? "🔒 Riêng tư" : "🌐 Công khai"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {form.visibility === "public" && (
            <p className="-mt-2 text-xs text-slate-500">Mọi người sẽ thấy topic này ở mục <b>Công khai</b> và luyện được với bản ghi riêng của họ. Chỉ bạn sửa được nội dung.</p>
          )}
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-sm font-medium">
              Nội dung · {lines.length} câu
              <button
                type="button"
                onClick={() => set("content", EXAMPLES[form.kind][form.language])}
                className="text-xs font-normal text-indigo-600 hover:underline"
              >
                Điền ví dụ
              </button>
            </span>
            <textarea
              className={`${input} h-72 font-mono text-sm`}
              required
              value={form.content}
              onChange={(e) => set("content", e.target.value)}
              placeholder={EXAMPLES[form.kind][form.language]}
            />
            <span className="mt-1 block text-xs leading-relaxed text-slate-500">
              Mỗi dòng là một câu.{" "}
              {form.kind === "dialogue" && (
                <>
                  Ghi người nói ở đầu dòng: <code className="rounded bg-slate-100 px-1">Anna: Hallo!</code> — mỗi người có một giọng đọc riêng.{" "}
                </>
              )}
              Thêm nghĩa sau dấu <code className="rounded bg-slate-100 px-1">|</code>. Dòng bắt đầu bằng <code className="rounded bg-slate-100 px-1">#</code> bị bỏ qua.
            </span>
          </label>

          {lines.length > 0 && (
            <div className="rounded-2xl bg-surface p-4 ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold text-slate-500">Xem trước · bấm 🖼 để thêm ảnh cho từng câu</h2>
              <ol className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
                {lines.map((l, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      {l.speaker && <span className="mr-1 font-semibold text-indigo-700">{l.speaker}:</span>}
                      {l.text}
                      {l.note && <div className="mt-0.5 text-xs text-slate-500">🇻🇳 {l.note}</div>}
                    </div>
                    <ImagePicker
                      variant="thumb"
                      url={lineImages.get(lineKey(l))?.url ?? ""}
                      onChange={(key, url) =>
                        setLineImages((m) => {
                          const n = new Map(m);
                          if (key) n.set(lineKey(l), { key, url });
                          else n.delete(lineKey(l));
                          return n;
                        })
                      }
                    />
                    {lineImages.has(lineKey(l)) && (
                      <button
                        type="button"
                        title="Bỏ ảnh"
                        onClick={() =>
                          setLineImages((m) => {
                            const n = new Map(m);
                            n.delete(lineKey(l));
                            return n;
                          })
                        }
                        className="text-xs text-slate-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {generation && generation.vocabulary.length > 0 && (
            <div className="rounded-2xl bg-surface p-4 ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold">🎒 Thêm vào Vocabulary Pocket</h2>
              <p className="text-xs text-slate-500">Các từ được chọn sẽ được lưu vào Pocket khi bạn tạo topic.</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {generation.vocabulary.map((v) => (
                  <li key={v.term}>
                    <label className="flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="accent-indigo-600"
                        checked={pocketPicks.has(v.term)}
                        onChange={(e) =>
                          setPocketPicks((p) => {
                            const n = new Set(p);
                            if (e.target.checked) n.add(v.term);
                            else n.delete(v.term);
                            return n;
                          })
                        }
                      />
                      <span className="font-medium">{v.term}</span>
                      <span className="text-slate-500">{v.meaning}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {editing && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Các câu không đổi nội dung sẽ giữ nguyên bản ghi âm. Câu bị xoá hoặc sửa chữ sẽ mất bản ghi cũ (của mọi người, nếu topic công khai).
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
            {busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Tạo topic"}
          </button>
        </form>
      </div>
    </div>
  );
}
