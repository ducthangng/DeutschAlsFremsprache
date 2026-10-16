export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Đang tải"
      className={`h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 ${className}`}
    />
  );
}
