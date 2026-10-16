import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import Cover from "../components/Cover";
import { useAuth } from "../lib/auth";

/** Titles for the decorative poster wall behind the form. */
const POSTERS = [
  "Am Bahnhof", "Job interview", "Beim Arzt", "Im Café", "Wohnung suchen", "At the airport", "Small talk", "Im Supermarkt",
  "Hotel check-in", "Auf der Bank", "Ordering food", "Der erste Tag", "Phone call", "Im Restaurant", "Doctor's visit", "Bürgeramt",
  "Making friends", "Fahrrad kaufen", "Meeting at work", "Im Kino", "Asking for help", "Beim Friseur", "Weekend plans", "Zug verpasst",
];

/** Input with a label that floats up when focused or filled. */
function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  trailing,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  trailing?: ReactNode;
}) {
  return (
    <label className="relative block">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder=" "
        className="peer h-14 w-full rounded-md border border-white/15 bg-[#16171c]/80 px-4 pb-2 pt-6 text-white outline-none transition focus:border-white/60 focus:ring-2 focus:ring-white/20"
      />
      <span className="pointer-events-none absolute left-4 top-2 text-xs text-white/50 transition-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs">
        {label}
      </span>
      {trailing && <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span>}
    </label>
  );
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/topics";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isLogin) await login(email, password);
      else await register(email, password, name);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {/* poster wall: our own topic covers, tilted and dimmed */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -inset-[20%] grid rotate-[-8deg] grid-cols-4 gap-3 opacity-70 sm:grid-cols-6 lg:grid-cols-8">
          {POSTERS.concat(POSTERS).map((title, i) => (
            <Cover key={i} title={title} className="aspect-video rounded-lg">
              <span className="absolute bottom-2 left-2.5 right-2 truncate text-xs font-semibold text-white/70">{title}</span>
            </Cover>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/35 to-black/85" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.6)_70%)]" />
      </div>

      <div className="relative flex min-h-dvh items-center justify-center px-4 pb-10 pt-24">
        <div className="w-full max-w-[450px] rounded-lg bg-black/75 px-6 py-10 backdrop-blur-sm sm:px-14 sm:py-12">
          <h1 className="text-3xl font-bold text-white">{isLogin ? "Đăng nhập" : "Tạo tài khoản"}</h1>
          <p className="mt-2 text-sm text-white/50">
            {isLogin ? "Chào mừng bạn quay lại luyện nói." : "Luyện nói tiếng Đức và tiếng Anh, mỗi ngày một chút."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {error && <p className="rounded-md bg-[#e87c03] px-4 py-3 text-sm text-white">{error}</p>}
            {!isLogin && <Field label="Tên hiển thị" value={name} onChange={setName} autoComplete="name" />}
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            <Field
              label={isLogin ? "Mật khẩu" : "Mật khẩu (ít nhất 8 ký tự)"}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={setPassword}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 8}
              trailing={
                password && (
                  <button type="button" onClick={() => setShowPassword((s) => !s)} className="text-xs font-medium text-white/60 hover:text-white">
                    {showPassword ? "Ẩn" : "Hiện"}
                  </button>
                )
              }
            />
            <button
              disabled={busy}
              className="mt-2 h-12 w-full rounded-md bg-[#ffda1a] font-semibold text-black transition hover:bg-[#ffe34d] disabled:opacity-60"
            >
              {busy ? "Đang xử lý…" : isLogin ? "Đăng nhập" : "Bắt đầu luyện tập"}
            </button>
          </form>

          <p className="mt-10 text-white/50">
            {isLogin ? "Mới dùng DeutschFremsprache? " : "Đã có tài khoản? "}
            <Link to={isLogin ? "/signup" : "/login"} state={location.state} className="font-medium text-white hover:underline">
              {isLogin ? "Đăng ký ngay." : "Đăng nhập."}
            </Link>
          </p>
          <p className="mt-4 text-xs leading-relaxed text-white/30">Luyện tập không giới hạn. Chỉ trả tiền cho phần AI bạn thực sự dùng.</p>
        </div>
      </div>
    </div>
  );
}
