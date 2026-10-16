import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  // Landing and sign-in pages carry their own call to action: logo only.
  const bare = !user && ["/", "/login", "/signup"].includes(path);
  // Sign-in pages draw a full-screen backdrop; the header floats over it.
  const overlay = !user && ["/login", "/signup"].includes(path);

  return (
    <div className="min-h-screen text-slate-900">
      <header className={overlay ? "absolute inset-x-0 top-0 z-20" : "sticky top-0 z-20 border-b border-white/5 bg-[#0d0e12]/85 backdrop-blur"}>
        <div className="flex h-14 w-full items-center justify-between px-4 sm:px-10">
          <Link to={user ? "/topics" : "/"} className="flex shrink-0 items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span>
              Deutsch<span className="text-indigo-600">Fremsprache</span>
            </span>
          </Link>
          <nav className={`no-scrollbar ml-4 flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-sm ${bare ? "hidden" : ""}`}>
            {user ? (
              <>
                {[
                  ["/topics", "Trang chủ"],
                  ["/public", "Khám phá"],
                  ["/playlists", "Playlist"],
                  ["/simulations", "Mô phỏng"],
                  ["/pocket", "Pocket"],
                  ["/usage", "Chi phí"],
                ].map(([to, label]) => (
                  <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) =>
                      `rounded-lg px-3 py-1.5 ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
                <span className="hidden px-2 text-slate-400 sm:inline">{user.name}</span>
                <button
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                  className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                >
                  Đăng xuất
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                  Đăng nhập
                </Link>
                <Link to="/signup" className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500">
                  Đăng ký
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
