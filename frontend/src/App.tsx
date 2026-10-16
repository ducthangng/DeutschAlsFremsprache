import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import Spinner from "./components/Spinner";
import { useAuth } from "./lib/auth";
import AuthPage from "./pages/AuthPage";
import Landing from "./pages/Landing";
import Pocket from "./pages/Pocket";
import Practice from "./pages/Practice";
import PublicTopics from "./pages/PublicTopics";
import TopicForm from "./pages/TopicForm";
import Home from "./pages/Home";
import PlaylistDetail from "./pages/PlaylistDetail";
import Playlists from "./pages/Playlists";
import SimulationRun from "./pages/SimulationRun";
import Simulations from "./pages/Simulations";
import Usage from "./pages/Usage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="mx-auto mt-24" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="register" />} />
        <Route path="/register" element={<Navigate to="/signup" replace />} />
        <Route path="/topics" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/playlists" element={<RequireAuth><Playlists /></RequireAuth>} />
        <Route path="/playlists/:id" element={<RequireAuth><PlaylistDetail /></RequireAuth>} />
        <Route path="/topics/new" element={<RequireAuth><TopicForm /></RequireAuth>} />
        <Route path="/topics/:id/edit" element={<RequireAuth><TopicForm /></RequireAuth>} />
        <Route path="/topics/:id" element={<RequireAuth><Practice /></RequireAuth>} />
        <Route path="/public" element={<RequireAuth><PublicTopics /></RequireAuth>} />
        <Route path="/simulations" element={<RequireAuth><Simulations /></RequireAuth>} />
        <Route path="/simulations/:id" element={<RequireAuth><SimulationRun /></RequireAuth>} />
        <Route path="/pocket" element={<RequireAuth><Pocket /></RequireAuth>} />
        <Route path="/usage" element={<RequireAuth><Usage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
