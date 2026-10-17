import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Avatar from "../components/Avatar";
import { LanguageBadge } from "../components/Cards";
import Spinner from "../components/Spinner";
import { api, type CostEvent, type CostFilter, type CostKind, type CostOverview, type CostPeriod, type CostSplit, type UsageReport } from "../lib/api";
import { formatUsd } from "../lib/format";

const PERIODS: { value: CostPeriod; label: string }[] = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "month", label: "Tháng này" },
  { value: "all", label: "Tất cả" },
];

const KINDS: Record<CostKind, { label: string; icon: string; color: string }> = {
  assess: { label: "Chấm phát âm", icon: "🎤", color: "bg-[#3987e5]/15 text-[#8ab8f2]" },
  script: { label: "Kịch bản AI", icon: "✨", color: "bg-[#8b5cf6]/15 text-[#c4b5fd]" },
  tts: { label: "Giọng đọc AI", icon: "🔊", color: "bg-indigo-100 text-indigo-700" },
  image: { label: "Ảnh AI", icon: "🖼", color: "bg-[#ec4899]/15 text-[#f9a8d4]" },
  simulation: { label: "Mô phỏng (LLM)", icon: "💬", color: "bg-amber-100 text-amber-700" },
  translate: { label: "Dịch nghĩa", icon: "🌐", color: "bg-emerald-100 text-emerald-700" },
};

const th = "px-3 py-2 font-medium";
const num = "px-3 py-2 text-right tabular-nums";

function KindBadge({ kind }: { kind: CostKind }) {
  const k = KINDS[kind];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${k.color}`}>{k.icon} {k.label}</span>;
}

/** "3,2 s" for audio, "1.204 token", "86 ký tự". */
function amount(e: { kind: CostKind; audioMs: number; tokens: number; chars: number }) {
  if (e.audioMs > 0) return `${(e.audioMs / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} s audio`;
  if (e.tokens > 0) return `${e.tokens.toLocaleString("vi-VN")} token`;
  if (e.chars > 0) return `${e.chars.toLocaleString("vi-VN")} ký tự`;
  return "–";
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
      <div className="mt-3 overflow-x-auto rounded-2xl bg-surface ring-1 ring-slate-200">{children}</div>
    </section>
  );
}

/** Cost columns shared by the user and topic tables. */
const splitHead = (
  <>
    <th className={`${th} text-right`}>Request</th>
    <th className={`${th} text-right`}>Chấm điểm</th>
    <th className={`${th} text-right`}>AI</th>
    <th className={`${th} text-right`}>Dịch</th>
    <th className={`${th} text-right`}>Tổng</th>
  </>
);
const splitCells = (c: CostSplit) => (
  <>
    <td className={num}>{c.requests.toLocaleString("vi-VN")}</td>
    <td className={`${num} text-slate-500`}>{formatUsd(c.gradingUsd)}</td>
    <td className={`${num} text-slate-500`}>{formatUsd(c.aiUsd)}</td>
    <td className={`${num} text-slate-500`}>{formatUsd(c.translationUsd)}</td>
    <td className={`${num} font-semibold text-slate-900`}>{formatUsd(c.costUsd)}</td>
  </>
);

function Empty({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-slate-400">
        Chưa có chi phí nào trong khoảng này.
      </td>
    </tr>
  );
}

export default function Usage() {
  const [period, setPeriod] = useState<CostPeriod>("month");
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");
  // Request-log filters; picking a user or topic row sets them.
  const [filter, setFilter] = useState<Omit<CostFilter, "period"> & { label?: string }>({});
  const [events, setEvents] = useState<CostEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api.usage().then(setReport, () => {});
  }, []);

  useEffect(() => {
    setOverview(null);
    api.costOverview(period).then(setOverview, (e) => setError(e.message));
  }, [period]);

  useEffect(() => {
    setEvents(null);
    api.costRequests({ ...filter, period }).then(
      (r) => {
        setEvents(r.requests);
        setHasMore(r.hasMore);
      },
      (e) => setError(e.message),
    );
  }, [period, filter]);

  async function loadMore() {
    if (!events) return;
    setLoadingMore(true);
    try {
      const r = await api.costRequests({ ...filter, period }, events.length);
      setEvents([...events, ...r.requests]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được");
    } finally {
      setLoadingMore(false);
    }
  }

  function showRequests(f: typeof filter) {
    setFilter(f);
    document.getElementById("requests")?.scrollIntoView({ behavior: "smooth" });
  }

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;

  const total = overview?.totals.reduce((s, t) => s + t.costUsd, 0) ?? 0;
  const requests = overview?.totals.reduce((s, t) => s + t.requests, 0) ?? 0;
  const topicLabel = (t: CostOverview["topics"][number]) =>
    t.scope === "simulation" ? "Mô phỏng hội thoại" : t.scope === "none" ? "Không gắn topic" : t.title || `Topic #${t.topicId} (đã xoá)`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Chi phí toàn hệ thống</h1>
          <p className="mt-1 text-sm text-slate-500">Mọi người dùng, mọi topic. Số liệu là ước tính theo đơn giá cấu hình.</p>
        </div>
        <div className="flex rounded-xl bg-surface p-1 ring-1 ring-slate-200">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${period === p.value ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!overview ? (
        <Spinner className="mx-auto mt-16" />
      ) : (
        <>
          {/* grand total */}
          <section className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">Tổng chi phí</div>
                <div className="text-4xl font-bold tabular-nums text-slate-900">≈ {formatUsd(total)}</div>
              </div>
              <div className="text-right text-sm text-slate-500">
                <b className="text-slate-800">{requests.toLocaleString("vi-VN")}</b> request · <b className="text-slate-800">{overview.users.filter((u) => u.userId).length}</b> người dùng
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {(Object.keys(KINDS) as CostKind[]).map((k) => {
                const t = overview.totals.find((x) => x.kind === k);
                const share = total > 0 && t ? (t.costUsd / total) * 100 : 0;
                return (
                  <button
                    key={k}
                    onClick={() => showRequests({ kind: k, label: KINDS[k].label })}
                    className="rounded-xl bg-slate-100 p-3 text-left transition hover:ring-1 hover:ring-indigo-300"
                    title="Xem các request loại này"
                  >
                    <div className="text-xs text-slate-500">
                      {KINDS[k].icon} {KINDS[k].label}
                    </div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{formatUsd(t?.costUsd ?? 0)}</div>
                    <div className="text-xs text-slate-400">{(t?.requests ?? 0).toLocaleString("vi-VN")} request</div>
                    <div className="mt-2 h-1 rounded-full bg-[#1f3a63]">
                      <div className="h-1 rounded-full bg-[#3987e5]" style={{ width: `${share}%` }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* by user */}
          <Section title="Theo người dùng" hint="Bấm một dòng để xem các request của người đó.">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className={th}>Người dùng</th>
                  {splitHead}
                  <th className={`${th} text-right`}>Gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {overview.users.length === 0 && <Empty cols={7} />}
                {overview.users.map((u) => (
                  <tr
                    key={u.userId}
                    onClick={() => u.userId && showRequests({ userId: u.userId, label: u.name })}
                    className={`border-b border-slate-50 last:border-0 ${u.userId ? "cursor-pointer hover:bg-slate-100" : ""}`}
                  >
                    <td className="px-3 py-2">
                      {u.userId ? (
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} url={u.avatarUrl} size={28} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-900">
                              {u.name} <span className="text-xs font-normal text-slate-400">#{u.userId}</span>
                            </div>
                            <div className="truncate text-xs text-slate-400">{u.email}</div>
                          </div>
                        </div>
                      ) : (
                        <i className="text-slate-400">Người dùng đã xoá</i>
                      )}
                    </td>
                    {splitCells(u)}
                    <td className={`${num} whitespace-nowrap text-xs text-slate-400`}>{new Date(u.lastAt).toLocaleString("vi-VN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* by topic */}
          <Section title="Theo topic" hint="Giọng đọc AI của một câu được tạo một lần rồi dùng chung, nên tính vào người tạo ra nó.">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <th className={th}>Topic</th>
                  <th className={`${th} text-right`}>Người dùng</th>
                  {splitHead}
                </tr>
              </thead>
              <tbody>
                {overview.topics.length === 0 && <Empty cols={7} />}
                {overview.topics.map((t) => (
                  <tr
                    key={`${t.scope}-${t.topicId}`}
                    onClick={() => showRequests({ scope: t.scope, topicId: t.topicId || undefined, label: topicLabel(t) })}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-100"
                  >
                    <td className="max-w-sm px-3 py-2">
                      <div className="flex items-center gap-2">
                        {t.language && <LanguageBadge language={t.language} size="sm" />}
                        <span className={`truncate font-medium ${t.scope === "topic" ? "text-slate-900" : "italic text-slate-500"}`}>{topicLabel(t)}</span>
                      </div>
                      {t.ownerName && <div className="truncate text-xs text-slate-400">của {t.ownerName}</div>}
                    </td>
                    <td className={`${num} text-slate-500`}>{t.users}</td>
                    {splitCells(t)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}

      {/* request log */}
      <section id="requests" className="mt-10 scroll-mt-20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Bảng request</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {filter.label && !filter.kind && (
              <span className="flex items-center gap-1.5 rounded-full bg-indigo-100 py-1 pl-3 pr-1.5 text-indigo-700">
                {filter.label}
                <button onClick={() => setFilter({})} className="rounded-full px-1.5 hover:bg-indigo-200" title="Bỏ lọc">
                  ✕
                </button>
              </span>
            )}
            <select
              value={filter.kind ?? ""}
              onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value as CostKind | "" }))}
              className="rounded-lg bg-surface px-3 py-1.5 ring-1 ring-slate-200"
            >
              <option value="">Mọi loại</option>
              {(Object.keys(KINDS) as CostKind[]).map((k) => (
                <option key={k} value={k}>
                  {KINDS[k].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl bg-surface ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs text-slate-500">
              <tr>
                <th className={th}>Thời gian</th>
                <th className={th}>Người dùng</th>
                <th className={th}>Loại</th>
                <th className={th}>Topic / nội dung</th>
                <th className={`${th} text-right`}>Lượng</th>
                <th className={th}>Nhà cung cấp</th>
                <th className={`${th} text-right`}>Chi phí</th>
              </tr>
            </thead>
            <tbody>
              {!events && (
                <tr>
                  <td colSpan={7} className="py-6">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              )}
              {events?.length === 0 && <Empty cols={7} />}
              {events?.map((e) => (
                <tr key={`${e.kind}-${e.id}`} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString("vi-VN")}</td>
                  <td className="whitespace-nowrap px-3 py-2">{e.userName || <i className="text-slate-400">–</i>}</td>
                  <td className="px-3 py-2">
                    <KindBadge kind={e.kind} />
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    {e.topicId ? (
                      <Link to={`/topics/${e.topicId}`} className="block truncate text-xs text-indigo-600 hover:underline">
                        {e.topicTitle || `Topic #${e.topicId}`}
                      </Link>
                    ) : e.simulationId ? (
                      <Link to={`/simulations/${e.simulationId}`} className="block truncate text-xs text-indigo-600 hover:underline">
                        💬 {e.simulationTitle || `Mô phỏng #${e.simulationId}`}
                      </Link>
                    ) : null}
                    {e.detail && <div className="truncate text-slate-700">{e.detail}</div>}
                  </td>
                  <td className={`${num} whitespace-nowrap text-xs text-slate-500`}>{amount(e)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{e.provider}</td>
                  <td className={`${num} font-medium`}>{e.provider === "mock" ? <span className="text-slate-400">mock</span> : formatUsd(e.costUsd)}</td>
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
      </section>

      {report && (
        <details className="mt-10 text-sm text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">Cách tính chi phí</summary>
          <p className="mt-2 max-w-3xl">
            Chấm phát âm tính theo thời lượng audio gửi lên Azure, đơn giá <b>${report.pricing.assessUsdPerHour}/giờ audio</b> (<code>AZURE_ASSESS_USD_PER_HOUR</code>). Dịch nghĩa dùng{" "}
            <b>{report.pricing.translator}</b>
            {report.pricing.translator === "azure" ? ` (~$${report.pricing.translatorUsdPerMChar}/1 triệu ký tự)` : " (miễn phí, có giới hạn mỗi ngày)"}; bản dịch đã cache không tính lại. Kịch bản và mô phỏng dùng{" "}
            <b>{report.pricing.chatModel}</b> (${report.pricing.chatUsdPerMInput}/1M token vào, ${report.pricing.chatUsdPerMOutput}/1M token ra). Giọng đọc mẫu dùng <b>{report.pricing.ttsModel}</b> (≈ $
            {report.pricing.ttsUsdPerMinute}/phút), mỗi câu tạo một lần và lưu trên {report.pricing.storage === "s3" ? "AWS S3" : "ổ đĩa máy chủ"}. Số tiền thật nằm trong Azure Cost Management và
            trang billing của OpenAI.
          </p>
        </details>
      )}
    </div>
  );
}
