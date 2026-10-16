import { useEffect, useState } from "react";
import Spinner from "../components/Spinner";
import { api, type AIUsagePeriod, type UsagePeriod, type UsageReport } from "../lib/api";
import { formatUsd } from "../lib/format";

function Period({ title, p, ai }: { title: string; p: UsagePeriod; ai: AIUsagePeriod }) {
  const total = p.gradingCostUsd + p.translationCostUsd + ai.scriptCostUsd + ai.ttsCostUsd + ai.imageCostUsd + ai.simulationCostUsd;
  const stat = (label: string, value: string, hint?: string) => (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return (
    <div className="rounded-2xl bg-surface p-5 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-2xl font-bold text-indigo-700 tabular-nums">≈ {formatUsd(total)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {stat("Lượt chấm (Azure)", String(p.gradings), `${p.passed} lượt đạt`)}
        {stat("Audio đã gửi", `${(p.audioSeconds / 60).toFixed(1)} phút`, `${p.audioSeconds.toFixed(0)} giây`)}
        {stat("Chi phí chấm điểm", formatUsd(p.gradingCostUsd))}
        {stat("Lượt dịch mới", String(p.translationCalls), "bản dịch đã cache không tính lại")}
        {stat("Ký tự đã dịch", p.translationChars.toLocaleString("vi-VN"))}
        {stat("Chi phí dịch", formatUsd(p.translationCostUsd))}
        {stat("Kịch bản AI đã tạo", String(ai.scripts))}
        {stat("Câu được tạo giọng (OpenAI)", String(ai.ttsClips), `${(ai.ttsAudioSeconds / 60).toFixed(1)} phút audio`)}
        {stat("Chi phí AI (kịch bản + giọng)", formatUsd(ai.scriptCostUsd + ai.ttsCostUsd), `${formatUsd(ai.scriptCostUsd)} + ${formatUsd(ai.ttsCostUsd)}`)}
        {stat("Ảnh AI cho flashcard", String(ai.images), formatUsd(ai.imageCostUsd))}
        {stat("Mô phỏng (AI hội thoại)", formatUsd(ai.simulationCostUsd), "phần chấm phát âm tính vào chấm điểm")}
      </div>
    </div>
  );
}

export default function Usage() {
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.usage().then(setData, (e) => setError(e.message));
  }, []);

  if (error) return <p className="mx-auto mt-16 max-w-xl rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>;
  if (!data) return <Spinner className="mx-auto mt-24" />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Chi phí & mức sử dụng</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500">
        Mỗi lượt chấm được tính theo thời lượng audio gửi lên Azure Pronunciation Assessment, với đơn giá ước tính{" "}
        <b>${data.pricing.assessUsdPerHour}/giờ audio</b> (speech-to-text + add-on pronunciation assessment; chỉnh bằng{" "}
        <code>AZURE_ASSESS_USD_PER_HOUR</code>). Azure Speech không tính theo token. Dịch nghĩa dùng <b>{data.pricing.translator}</b>
        {data.pricing.translator === "azure" ? ` với đơn giá ~$${data.pricing.translatorUsdPerMChar}/1 triệu ký tự` : " (miễn phí, có giới hạn mỗi ngày)"}. Đây
        là số ước tính; số tiền thật nằm trong Azure Cost Management. Gói F0 miễn phí 5 giờ audio mỗi tháng. Kịch bản AI dùng <b>{data.pricing.chatModel}</b> (${data.pricing.chatUsdPerMInput}/1M token vào, $
        {data.pricing.chatUsdPerMOutput}/1M token ra). Giọng đọc mẫu (tiếng Đức và tiếng Anh) dùng <b>{data.pricing.ttsModel}</b> (≈ ${data.pricing.ttsUsdPerMinute}/phút audio). Mỗi câu chỉ được tạo một lần,
        được lưu trên {data.pricing.storage === "s3" ? "AWS S3" : "ổ đĩa máy chủ"} và dùng lại cho mọi người.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Period title="Tháng này" p={data.month} ai={data.monthAi} />
        <Period title="Từ trước đến nay" p={data.allTime} ai={data.allTimeAi} />
      </div>

      <h2 className="mt-10 font-semibold">50 lượt chấm gần nhất</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl bg-surface ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Thời gian</th>
              <th className="px-4 py-2 font-medium">Câu</th>
              <th className="px-4 py-2 text-right font-medium">Điểm</th>
              <th className="px-4 py-2 text-right font-medium">Audio</th>
              <th className="px-4 py-2 text-right font-medium">Độ trễ</th>
              <th className="px-4 py-2 text-right font-medium">Chi phí</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Chưa có lượt chấm nào.
                </td>
              </tr>
            )}
            {data.recent.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-slate-500">{new Date(a.createdAt).toLocaleString("vi-VN")}</td>
                <td className="max-w-xs px-4 py-2">
                  <div className="truncate">{a.itemText || <i className="text-slate-400">(câu đã xoá)</i>}</div>
                  <div className="truncate text-xs text-slate-400">{a.topicTitle}</div>
                </td>
                <td className={`px-4 py-2 text-right font-medium tabular-nums ${a.passed ? "text-emerald-600" : "text-red-500"}`}>{Math.round(a.pronScore)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(a.audioMs / 1000).toFixed(1)}s</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{a.latencyMs} ms</td>
                <td className="px-4 py-2 text-right tabular-nums">{a.provider === "mock" ? <span className="text-slate-400">mock</span> : formatUsd(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
