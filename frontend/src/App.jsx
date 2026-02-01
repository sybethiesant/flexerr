import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';

// Pages
import Dashboard from './pages/Dashboard';
import Discover from './pages/Discover';
import MediaDetails from './pages/MediaDetails';
import Watchlist from './pages/Watchlist';
import Requests from './pages/Requests';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Users from './pages/Users';
import Rules from './pages/Rules';
import RuleEditor from './pages/RuleEditor';
import Categorization from './pages/Categorization';
import CategorizationEditor from './pages/CategorizationEditor';
import Collections from './pages/Collections';
import LeavingSoon from './pages/LeavingSoon';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Admin from './pages/Admin';

// Components
import Navbar from './components/Navbar';
import SearchBar from './components/SearchBar';
import AdminLayout from './components/AdminLayout';
import { ToastProvider } from './components/Toast';

// API configuration
const API_BASE = '/api';

export const api = axios.create({
  baseURL: API_BASE
});

// Token refresh logic
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Add access token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('flexerr_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses with token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('flexerr_refresh_token');
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('flexerr_access_token');
        localStorage.removeItem('flexerr_refresh_token');
        localStorage.removeItem('flexerr_user');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefreshToken } = res.data;

        localStorage.setItem('flexerr_access_token', accessToken);
        localStorage.setItem('flexerr_refresh_token', newRefreshToken);
        localStorage.setItem('flexerr_user', JSON.stringify(res.data.user));

        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        processQueue(null, accessToken);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('flexerr_access_token');
        localStorage.removeItem('flexerr_refresh_token');
        localStorage.removeItem('flexerr_user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('flexerr_user');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Invalid JSON in localStorage, clear it
        localStorage.removeItem('flexerr_user');
        localStorage.removeItem('flexerr_access_token');
        localStorage.removeItem('flexerr_refresh_token');
        return null;
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const accessToken = localStorage.getItem('flexerr_access_token');
    if (accessToken) {
      api.get('/auth/me')
        .then(res => {
          setUser(res.data);
          localStorage.setItem('flexerr_user', JSON.stringify(res.data));
        })
        .catch(() => {
          localStorage.removeItem('flexerr_access_token');
          localStorage.removeItem('flexerr_refresh_token');
          localStorage.removeItem('flexerr_user');
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const loginWithPlex = async (plexToken) => {
    const res = await api.post('/auth/plex/callback', { plexToken });
    if (res.data.success) {
      localStorage.setItem('flexerr_access_token', res.data.accessToken);
      localStorage.setItem('flexerr_refresh_token', res.data.refreshToken);
      localStorage.setItem('flexerr_user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return res.data;
    }
    throw new Error(res.data.error || 'Login failed');
  };

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('flexerr_refresh_token');
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch (e) {
      // Ignore logout errors
    }
    localStorage.removeItem('flexerr_access_token');
    localStorage.removeItem('flexerr_refresh_token');
    localStorage.removeItem('flexerr_user');
    setUser(null);
    navigate('/login');
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, loginWithPlex, logout, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// Protected Route wrapper
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// Main Layout with Navbar
function MainLayout({ children, showSearch = true }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-900">
      <Navbar />
      {showSearch && (
        <div className="bg-slate-800 border-b border-slate-700 py-3">
          <div className="max-w-7xl mx-auto px-4">
            <SearchBar />
          </div>
        </div>
      )}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}

function AppRoutes() {
  const [setupStatus, setSetupStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    api.get('/setup/status')
      .then(res => setSetupStatus(res.data))
      .catch(err => {
        console.error('Setup status check failed:', err);
        // On API error (rate limiting, network issues), assume setup is complete
        // to prevent incorrectly showing setup screen
        setApiError(true);
        setSetupStatus({ setupComplete: true, hasUsers: true, hasTmdbKey: true });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  // Redirect to setup if not complete
  if (!setupStatus?.setupComplete) {
    return (
      <Routes>
        <Route path="/setup/*" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup/*" element={<Navigate to="/" replace />} />

      {/* Main Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout><Dashboard /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/discover"
        element={
          <ProtectedRoute>
            <MainLayout><Discover /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/discover/:mediaType/:id"
        element={
          <ProtectedRoute>
            <MainLayout showSearch={false}><MediaDetails /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/watchlist"
        element={
          <ProtectedRoute>
            <MainLayout><Watchlist /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/requests"
        element={
          <ProtectedRoute>
            <MainLayout><Requests /></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leaving-soon"
        element={
          <ProtectedRoute>
            <MainLayout><LeavingSoon /></MainLayout>
          </ProtectedRoute>
        }
      />

      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Admin /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Settings /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Users /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/logs"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Logs /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rules"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Rules /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rules/new"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><RuleEditor /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rules/:id"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><RuleEditor /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/categorization"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Categorization /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/categorization/new"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><CategorizationEditor /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/categorization/:id"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><CategorizationEditor /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/queue"
        element={
          <ProtectedRoute adminOnly>
            <MainLayout showSearch={false}><AdminLayout><Collections /></AdminLayout></MainLayout>
          </ProtectedRoute>
        }
      />

      {/* Legacy redirects */}
      <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />
      <Route path="/users" element={<Navigate to="/admin/users" replace />} />
      <Route path="/logs" element={<Navigate to="/admin/logs" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}
