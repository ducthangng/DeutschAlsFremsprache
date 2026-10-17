import { useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import Avatar from "./Avatar";
import { useDialog } from "./Dialog";
import Popover from "./Popover";

/** Profile picture in the header, with a menu to change it and to log out. */
function ProfileMenu() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const dialog = useDialog();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function upload(f?: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      setUser(await api.setAvatar(f));
    } catch (e) {
      dialog.alert("Không đổi được ảnh đại diện", e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <Popover label={<Avatar name={user.name} url={user.avatarUrl} size={28} className={busy ? "opacity-50" : ""} />} title="Tài khoản" width="w-64">
        {(close) => (
          <div className="-m-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar name={user.name} url={user.avatarUrl} size={40} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{user.name}</p>
                <p className="truncate text-xs text-slate-400">{user.email}</p>
              </div>
            </div>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => {
                close();
                file.current?.click();
              }}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
            >
              🖼 Đổi ảnh đại diện
            </button>
            {user.avatarUrl && (
              <button
                onClick={async () => {
                  close();
                  setUser(await api.removeAvatar());
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-slate-500 hover:bg-slate-100"
              >
                Bỏ ảnh đại diện
              </button>
            )}
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => {
                close();
                logout();
                navigate("/");
              }}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
            >
              Đăng xuất
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}

export default function Layout() {
  const { user } = useAuth();
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
                  ...(user.isAdmin ? [["/activity", "Hoạt động"], ["/usage", "Chi phí"]] : []),
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
          {user && <div className="ml-2 shrink-0">{<ProfileMenu />}</div>}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
