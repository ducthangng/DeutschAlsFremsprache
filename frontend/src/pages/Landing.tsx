import { Link } from "react-router-dom";
import LandingDemo from "../components/LandingDemo";
import { useAuth } from "../lib/auth";

/**
 * One screen, no scroll: a single message, a single action, and a silent demo
 * of a practice round. Height = viewport minus the 57px header (56px bar + 1px border).
 */
export default function Landing() {
  const { user } = useAuth();
  return (
    <section className="flex h-[calc(100dvh-57px)] flex-col justify-between overflow-hidden px-6 py-8 sm:px-16 sm:py-14">
      <div />

      <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        <div className="max-w-4xl">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight text-slate-900 sm:text-7xl lg:text-6xl xl:text-7xl 2xl:text-8xl">
            Practice makes
            <br />
            perfect.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-500 sm:text-xl">
            You practice. I&apos;ll be here to support you,
            <br className="hidden sm:block" /> all the way to the end.
          </p>
          <div className="mt-8 flex items-center gap-6 sm:mt-10">
            <Link
              to={user ? "/topics" : "/signup"}
              className="rounded-full bg-[#ffda1a] px-8 py-3.5 font-semibold text-black transition hover:bg-[#ffe34d]"
            >
              {user ? "Continue" : "Start practicing"}
            </Link>
            {!user && (
              <Link to="/login" className="font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline">
                Log in
              </Link>
            )}
          </div>
        </div>

        {/* On short phone screens the demo would not fit without scrolling, so it steps aside. */}
        <LandingDemo className="max-w-2xl justify-self-center [@media(max-height:760px)_and_(max-width:1023px)]:hidden lg:justify-self-end" />
      </div>

      <footer className="mt-6 flex flex-col-reverse gap-3 text-sm sm:mt-0 text-slate-400 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <p className="shrink-0">Deutsch · English</p>
        <figure className="max-w-md sm:text-right">
          <blockquote className="italic text-slate-500">
            &ldquo;If you practice for 10.000 hours and still cannot master the skill, then at least you tried.&rdquo;
          </blockquote>
          <figcaption className="mt-1 text-xs">
            — Friedrich Nietzsche <span className="text-slate-300">(never said this)</span>
          </figcaption>
        </figure>
      </footer>
    </section>
  );
}
