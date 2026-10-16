/** Formats a (usually tiny) USD amount: $0.00067, $0.012. */
export function formatUsd(v: number) {
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(3)}`;
}
