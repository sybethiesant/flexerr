import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../App';
import {
  Film, Server, CheckCircle, ArrowRight, ArrowLeft,
  AlertCircle, Loader2, ExternalLink
} from 'lucide-react';

const steps = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'plex', title: 'Connect Plex' },
  { id: 'arr', title: 'Connect *arr' },
  { id: 'complete', title: 'Complete' }
];

export default function Setup() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    plexUrl: '',
    plexToken: '',
    sonarrUrl: '',
    sonarrApiKey: '',
    radarrUrl: '',
    radarrApiKey: ''
  });
  const [errors, setErrors] = useState({});
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [plexAuth, setPlexAuth] = useState({ loading: false, polling: false, servers: null, token: null });
  const pollingRef = useRef(null);

  const navigate = useNavigate();

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const updateForm = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const startPlexAuth = async () => {
    setPlexAuth({ loading: true, polling: false, servers: null, token: null });
    try {
      const res = await api.post('/auth/plex/start');
      const { id, authUrl } = res.data;

      // Open Plex auth in popup
      window.open(authUrl, 'plex-auth', 'width=800,height=700');

      // Poll for token
      setPlexAuth(prev => ({ ...prev, loading: false, polling: true }));
      pollingRef.current = setInterval(async () => {
        try {
          const checkRes = await api.get(`/auth/plex/callback/${id}`);
          if (checkRes.data.success && checkRes.data.plexToken) {
            clearInterval(pollingRef.current);

            // Got token, now get servers
            const serversRes = await api.get('/plex/servers', {
              headers: { 'X-Plex-Token': checkRes.data.plexToken }
            });

            setPlexAuth({
              loading: false,
              polling: false,
              token: checkRes.data.plexToken,
              servers: serversRes.data || []
            });

            // Auto-select if only one server
            if (serversRes.data?.length === 1) {
              selectPlexServer(serversRes.data[0], checkRes.data.plexToken);
            }
          }
        } catch (err) {
          // Still polling, continue
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          setPlexAuth(prev => {
            if (prev.polling) {
              return { loading: false, polling: false, servers: null, token: null };
            }
            return prev;
          });
        }
      }, 300000);
    } catch (err) {
      setErrors({ plex: err.response?.data?.error || err.message });
      setPlexAuth({ loading: false, polling: false, servers: null, token: null });
    }
  };

  const selectPlexServer = (server, token = plexAuth.token) => {
    const conn = server.connections?.find(c => c.local && !c.relay) ||
                 server.connections?.find(c => !c.relay) ||
                 server.connections?.[0];
    const url = conn?.uri || server.url || '';
    updateForm('plexUrl', url);
    updateForm('plexToken', token);
    // Pass values directly since React state updates are async
    testConnection('plex', { url, api_key: token });
  };

  const testConnection = async (type, overrideConfig = null) => {
    const configs = {
      plex: { url: formData.plexUrl, api_key: formData.plexToken },
      tmdb: { api_key: formData.tmdbApiKey },
      sonarr: { url: formData.sonarrUrl, api_key: formData.sonarrApiKey },
      radarr: { url: formData.radarrUrl, api_key: formData.radarrApiKey }
    };

    const config = overrideConfig || configs[type];
    if (!config.url && type !== 'tmdb') return;
    if (type === 'tmdb' && !config.api_key) return;

    setTesting(prev => ({ ...prev, [type]: true }));
    setTestResults(prev => ({ ...prev, [type]: null }));

    try {
      const res = await api.post('/services/test', { type, ...config });
      setTestResults(prev => ({ ...prev, [type]: res.data }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [type]: { success: false, error: err.response?.data?.error || err.message }
      }));
    } finally {
      setTesting(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleNext = async () => {
    const step = steps[currentStep].id;

    // Validate plex step
    if (step === 'plex') {
      if (!formData.plexUrl || !formData.plexToken) {
        setErrors({ plexUrl: 'Please connect to Plex first' });
        return;
      }
      if (!testResults.plex?.success) {
        setErrors({ plexUrl: 'Please verify the connection works' });
        return;
      }
    }

    // On complete step - save everything
    if (step === 'complete') {
      setLoading(true);
      try {
        const services = [];
        if (formData.plexUrl) {
          services.push({ type: 'plex', name: 'Plex', url: formData.plexUrl, api_key: formData.plexToken });
        }
        if (formData.sonarrUrl) {
          services.push({ type: 'sonarr', name: 'Sonarr', url: formData.sonarrUrl, api_key: formData.sonarrApiKey });
        }
        if (formData.radarrUrl) {
          services.push({ type: 'radarr', name: 'Radarr', url: formData.radarrUrl, api_key: formData.radarrApiKey });
        }

        const res = await api.post('/setup/complete', {
          plexToken: formData.plexToken,
          plexUrl: formData.plexUrl,
          services
        });

        if (res.data.success) {
          localStorage.setItem('flexerr_access_token', res.data.accessToken);
          localStorage.setItem('flexerr_refresh_token', res.data.refreshToken);
          localStorage.setItem('flexerr_user', JSON.stringify(res.data.user));
          window.location.href = '/';
        }
      } catch (err) {
        setErrors({ complete: err.response?.data?.error || err.message });
        setLoading(false);
      }
      return;
    }

    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  const renderStep = () => {
    const step = steps[currentStep].id;

    switch (step) {
      case 'welcome':
        return (
          <div className="text-center space-y-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-primary-700">
              <Film className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">Welcome to Flexerr</h1>
            <p className="text-slate-400 max-w-md mx-auto">
              Flexerr is your media request and lifecycle manager. Browse content,
              add to your watchlist, and automatically download what you want to watch.
            </p>
            <div className="bg-slate-800/50 rounded-lg p-4 text-left max-w-md mx-auto">
              <h3 className="font-medium text-white mb-2">What you'll need:</h3>
              <ul className="text-slate-400 text-sm space-y-1">
                <li>- Plex account with server access</li>
                <li>- TMDB API key (free at themoviedb.org)</li>
                <li>- Sonarr for TV shows (optional)</li>
                <li>- Radarr for movies (optional)</li>
              </ul>
            </div>
          </div>
        );

      case 'plex':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Server className="h-12 w-12 text-primary-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white">Connect to Plex</h2>
              <p className="text-slate-400 mt-2">Sign in with Plex to become the first admin</p>
            </div>

            <div className="max-w-md mx-auto space-y-4">
              {!formData.plexToken && (
                <>
                  <button
                    type="button"
                    onClick={startPlexAuth}
                    disabled={plexAuth.loading || plexAuth.polling}
                    className="w-full flex items-center justify-center space-x-3 px-6 py-4 rounded-lg font-semibold text-white transition-all"
                    style={{ backgroundColor: '#E5A00D' }}
                  >
                    {plexAuth.loading || plexAuth.polling ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>{plexAuth.polling ? 'Waiting for authorization...' : 'Loading...'}</span>
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

                  {plexAuth.servers && plexAuth.servers.length > 1 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Select Your Server</label>
                      <select
                        onChange={(e) => {
                          const server = plexAuth.servers.find(s => s.clientIdentifier === e.target.value);
                          if (server) selectPlexServer(server);
                        }}
                        className="w-full bg-slate-700 border-slate-600 text-white rounded-lg"
                      >
                        <option value="">-- Choose a server --</option>
                        {plexAuth.servers.map(s => (
                          <option key={s.clientIdentifier} value={s.clientIdentifier}>
                            {s.name} {s.owned ? '(owned)' : '(shared)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {formData.plexToken && (
                <>
                  {testing.plex && (
                    <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
                      <div className="flex items-center space-x-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Testing connection to Plex...</span>
                      </div>
                    </div>
                  )}

                  {!testing.plex && testResults.plex?.success && (
                    <div className="p-3 rounded-lg bg-green-500/10 text-green-400">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="h-4 w-4" />
                        <span>Connected to {testResults.plex.name}</span>
                      </div>
                    </div>
                  )}

                  {!testing.plex && testResults.plex && !testResults.plex.success && (
                    <div className="p-3 rounded-lg bg-red-500/10 text-red-400">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>{testResults.plex.error || 'Connection failed'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => testConnection('plex')}
                        className="mt-2 text-sm underline hover:no-underline"
                      >
                        Retry connection test
                      </button>
                    </div>
                  )}

                  {!testing.plex && !testResults.plex && (
                    <button
                      type="button"
                      onClick={() => testConnection('plex')}
                      className="btn w-full bg-slate-700 hover:bg-slate-600 text-white"
                    >
                      Test Connection
                    </button>
                  )}
                </>
              )}

              {errors.plexUrl && !formData.plexToken && (
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400">
                  <div className="flex items-center space-x-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>{errors.plexUrl}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'arr':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Server className="h-12 w-12 text-primary-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white">Connect Download Services</h2>
              <p className="text-slate-400 mt-2">Connect Sonarr and Radarr for automatic downloads</p>
            </div>

            <div className="max-w-md mx-auto space-y-6">
              {/* Sonarr */}
              <div className="bg-slate-800 rounded-lg p-4 space-y-3">
                <h3 className="font-medium text-white">Sonarr (TV Shows)</h3>
                <input
                  type="url"
                  placeholder="http://192.168.1.100:8989"
                  value={formData.sonarrUrl}
                  onChange={(e) => updateForm('sonarrUrl', e.target.value)}
                  className="w-full bg-slate-700 border-slate-600 text-white rounded-lg"
                />
                <input
                  type="password"
                  placeholder="API Key"
                  value={formData.sonarrApiKey}
                  onChange={(e) => updateForm('sonarrApiKey', e.target.value)}
                  className="w-full bg-slate-700 border-slate-600 text-white rounded-lg"
                />
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => testConnection('sonarr')}
                    disabled={testing.sonarr || !formData.sonarrUrl}
                    className="btn bg-slate-700 hover:bg-slate-600 text-white text-sm"
                  >
                    {testing.sonarr ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                  </button>
                  {testResults.sonarr && (
                    <span className={testResults.sonarr.success ? 'text-green-400' : 'text-red-400'}>
                      {testResults.sonarr.success ? 'Connected' : testResults.sonarr.error}
                    </span>
                  )}
                </div>
              </div>

              {/* Radarr */}
              <div className="bg-slate-800 rounded-lg p-4 space-y-3">
                <h3 className="font-medium text-white">Radarr (Movies)</h3>
                <input
                  type="url"
                  placeholder="http://192.168.1.100:7878"
                  value={formData.radarrUrl}
                  onChange={(e) => updateForm('radarrUrl', e.target.value)}
                  className="w-full bg-slate-700 border-slate-600 text-white rounded-lg"
                />
                <input
                  type="password"
                  placeholder="API Key"
                  value={formData.radarrApiKey}
                  onChange={(e) => updateForm('radarrApiKey', e.target.value)}
                  className="w-full bg-slate-700 border-slate-600 text-white rounded-lg"
                />
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => testConnection('radarr')}
                    disabled={testing.radarr || !formData.radarrUrl}
                    className="btn bg-slate-700 hover:bg-slate-600 text-white text-sm"
                  >
                    {testing.radarr ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                  </button>
                  {testResults.radarr && (
                    <span className={testResults.radarr.success ? 'text-green-400' : 'text-red-400'}>
                      {testResults.radarr.success ? 'Connected' : testResults.radarr.error}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-slate-500 text-sm text-center">
                These are optional but required for automatic downloads.
              </p>
            </div>
          </div>
        );

      case 'complete':
        return (
          <div className="text-center space-y-6">
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold text-white">Ready to Go!</h2>
            <p className="text-slate-400 max-w-md mx-auto">
              Flexerr is configured and ready. You'll be signed in as the admin.
              Start browsing content and adding to your watchlist.
            </p>
            {errors.complete && (
              <div className="bg-red-500/10 text-red-400 p-3 rounded-lg">
                {errors.complete}
              </div>
            )}
            <div className="bg-slate-800/50 rounded-lg p-4 text-left max-w-md mx-auto">
              <h3 className="font-medium text-white mb-2">What's next:</h3>
              <ul className="text-slate-400 text-sm space-y-1">
                <li>- Browse trending and popular content</li>
                <li>- Add movies and shows to your watchlist</li>
                <li>- Flexerr will automatically download them</li>
                <li>- Invite friends - they can sign in with Plex too</li>
              </ul>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900">
      <div className="w-full max-w-2xl">
        {/* Progress */}
        <div className="flex items-center justify-center mb-8 space-x-2">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index < currentStep
                    ? 'bg-primary-600 text-white'
                    : index === currentStep
                    ? 'bg-primary-500 text-white'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {index < currentStep ? <CheckCircle className="h-4 w-4" /> : index + 1}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`w-12 h-0.5 ${
                    index < currentStep ? 'bg-primary-600' : 'bg-slate-700'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="card bg-slate-800 p-8 rounded-xl">
          {renderStep()}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-slate-700">
            <button
              onClick={handleBack}
              disabled={currentStep === 0 || loading}
              className="btn bg-slate-700 hover:bg-slate-600 text-white flex items-center space-x-2 disabled:opacity-0"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </button>

            <button
              onClick={handleNext}
              disabled={loading}
              className="btn btn-primary flex items-center space-x-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>{currentStep === steps.length - 1 ? 'Get Started' : 'Continue'}</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
