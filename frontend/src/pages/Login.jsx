import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuth } from '../App';
import { Film, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

// Flexerr uses Plex OAuth - this page handles user sign-in
function Login() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState(null);
  const [logoError, setLogoError] = useState(false);
  const pollingRef = useRef(null);

  useEffect(() => {
    if (user) {
      navigate('/');
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [user, navigate]);

  const startPlexAuth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/plex/start');
      const { id, authUrl } = res.data;

      // Open Plex auth in popup
      window.open(authUrl, 'plex-auth', 'width=800,height=700');

      // Start polling
      setLoading(false);
      setPolling(true);
      pollingRef.current = setInterval(async () => {
        try {
          const checkRes = await api.get(`/auth/plex/callback/${id}`);
          if (checkRes.data.invited) {
            clearInterval(pollingRef.current);
            setPolling(false);
            setError(checkRes.data.message || 'An invitation to the Plex server has been sent to your email. Please accept it and try logging in again.');
            return;
          }
          if (checkRes.data.success) {
            clearInterval(pollingRef.current);
            setPolling(false);

            // Check if we got full login data (user + tokens)
            if (checkRes.data.accessToken && checkRes.data.user) {
              // Store tokens and user
              localStorage.setItem('flexerr_access_token', checkRes.data.accessToken);
              localStorage.setItem('flexerr_refresh_token', checkRes.data.refreshToken);
              localStorage.setItem('flexerr_user', JSON.stringify(checkRes.data.user));

              // Show warning if auto-invite failed
              if (checkRes.data.warning) {
                toast.error(checkRes.data.warning, { duration: 8000 });
              }

              // Reload to pick up new auth state
              window.location.href = '/';
            } else if (checkRes.data.plexToken) {
              // Setup mode - redirect to setup with token
              setError('Please complete setup first');
            }
          }
        } catch (err) {
          // Still waiting, continue polling
        }
      }, 2000);

      // Timeout after 5 minutes
      setTimeout(() => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          setPolling(false);
          setError('Login timed out. Please try again.');
        }
      }, 300000);
    } catch (err) {
      setLoading(false);
      setError(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900">
      <div className="w-full max-w-md">
        <div className="text-center space-y-6">
          {!logoError ? (
            <img
              src="/flexerr-logo.png"
              alt="Flexerr"
              className="w-64 h-64 mx-auto object-contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <h1 className="text-4xl font-bold text-white">Flexerr</h1>
          )}
          <p className="text-slate-400">Sign in with your Plex account to continue</p>

          <button
            type="button"
            onClick={startPlexAuth}
            disabled={loading || polling}
            className="w-full flex items-center justify-center space-x-3 px-6 py-4 rounded-lg font-semibold text-white transition-all disabled:opacity-70"
            style={{ backgroundColor: '#E5A00D' }}
          >
            {loading || polling ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{polling ? 'Waiting for authorization...' : 'Loading...'}</span>
              </>
            ) : (
              <>
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5l7.5 7.5-7.5 7.5V4.5z"/>
                </svg>
                <span>Sign in with Plex</span>
              </>
            )}
          </button>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
