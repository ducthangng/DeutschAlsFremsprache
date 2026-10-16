import { formatUsd } from "../lib/format";

/** One quiet line: visibility · completions · total cost. */
export default function TopicStatus({ topic }: { topic: { visibility: string; completions: number; totalCostUsd: number } }) {
  return (
    <p className="mt-3 text-xs text-slate-400" title="Trạng thái · số lần hoàn thành (mọi người) · tổng chi phí (mọi người)">
      {topic.visibility === "public" ? "🌐 Công khai" : "🔒 Riêng tư"} · ✓ {topic.completions} lần · ≈ {formatUsd(topic.totalCostUsd)}
    </p>
  );
}
