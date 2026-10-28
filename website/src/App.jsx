import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import BgRemove from './pages/BgRemove';
import Upscale from './pages/Upscale';
import Imagine from './pages/Imagine';
import Video from './pages/Video';
import Voice from './pages/Voice';
import Premium from './pages/Premium';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/tools/bg-remove" element={<BgRemove />} />
        <Route path="/tools/upscale" element={<Upscale />} />
        <Route path="/tools/imagine" element={<Imagine />} />
        <Route path="/tools/video" element={<Video />} />
        <Route path="/tools/voice" element={<Voice />} />
        <Route path="/premium" element={<Premium />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
