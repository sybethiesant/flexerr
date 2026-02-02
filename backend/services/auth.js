/**
 * Authentication Service for Flexerr
 * Handles Plex OAuth and Jellyfin username/password authentication, plus JWT token management
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getSetting, createOrUpdateUser, createOrUpdateUserGeneric, getUserById, getUserByPlexId, getUserByMediaServerId, createSession, getSessionByTokenHash, deleteSession, cleanExpiredSessions, getMediaServerByType, log, recordPlexInvitation, markInvitationAccepted } = require('../database');

const PLEX_AUTH_URL = 'https://plex.tv/api/v2';
const PLEX_PRODUCT = 'Flexerr';
const PLEX_DEVICE = 'Flexerr Server';

// JWT Configuration
// Extended tokens for persistent login - user preference over frequent re-auth
const ACCESS_TOKEN_EXPIRY = '30d';  // 30 days for active sessions
const REFRESH_TOKEN_EXPIRY_DAYS = 365;  // 1 year for persistent login

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'flexerr-secret-change-me';
    this.clientId = getSetting('plex_client_id') || 'flexerr-media-manager';

    // Clean expired sessions on startup
    cleanExpiredSessions();
  }

  /**
   * Create a Plex auth PIN for OAuth flow
   * Returns PIN id and authUrl for user to visit
   */
  async createAuthPin() {
    try {
      const response = await axios.post(`${PLEX_AUTH_URL}/pins`, null, {
        params: {
          strong: true,
          'X-Plex-Product': PLEX_PRODUCT,
          'X-Plex-Client-Identifier': this.clientId,
          'X-Plex-Device': PLEX_DEVICE
        },
        headers: {
          'Accept': 'application/json'
        }
      });

      const { id, code } = response.data;
      const authUrl = `https://app.plex.tv/auth#?clientID=${this.clientId}&code=${code}&context[device][product]=${encodeURIComponent(PLEX_PRODUCT)}`;

      return {
        id,
        code,
        authUrl
      };
    } catch (error) {
      console.error('[Auth] Error creating Plex PIN:', error.message);
      throw new Error('Failed to create Plex authentication PIN');
    }
  }

  /**
   * Check if a Plex PIN has been authorized
   * Returns the auth token if authorized, null otherwise
   */
  async checkAuthPin(pinId) {
    try {
      const response = await axios.get(`${PLEX_AUTH_URL}/pins/${pinId}`, {
        params: {
          'X-Plex-Client-Identifier': this.clientId
        },
        headers: {
          'Accept': 'application/json'
        }
      });

      const { authToken } = response.data;

      if (authToken) {
        return { success: true, token: authToken };
      }

      return { success: false };
    } catch (error) {
      console.error('[Auth] Error checking Plex PIN:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate a Plex token and get user information
   */
  async validatePlexToken(plexToken) {
    try {
      const response = await axios.get('https://plex.tv/api/v2/user', {
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': plexToken,
          'X-Plex-Client-Identifier': this.clientId
        }
      });

      const user = response.data;

      return {
        success: true,
        user: {
          plex_id: user.id.toString(),
          username: user.username || user.title,
          email: user.email,
          thumb: user.thumb
        }
      };
    } catch (error) {
      console.error('[Auth] Error validating Plex token:', error.message);
      return { success: false, error: 'Invalid Plex token' };
    }
  }

  /**
   * Check if user has access to the configured Plex server
   * Also determines if user is the server owner
   * If auto-invite is enabled, will invite users who don't have access
   */
  async checkServerAccess(plexToken, userInfo = null) {
    try {
      // Get user's resources (servers they have access to)
      const response = await axios.get('https://plex.tv/api/v2/resources', {
        params: {
          includeHttps: 1,
          includeRelay: 1
        },
        headers: {
          'Accept': 'application/json',
          'X-Plex-Token': plexToken,
          'X-Plex-Client-Identifier': this.clientId
        }
      });

      const servers = response.data.filter(r => r.provides === 'server');

      // Get configured Plex server URL to match
      const configuredPlexUrl = await this.getConfiguredPlexUrl();

      if (!configuredPlexUrl) {
        // No Plex configured yet - during initial setup
        return { success: true, servers, isOwner: false };
      }

      // Find matching server
      let matchedServer = null;
      let isOwner = false;

      for (const server of servers) {
        const connections = server.connections || [];
        for (const conn of connections) {
          if (this.urlsMatch(conn.uri, configuredPlexUrl)) {
            matchedServer = server;
            isOwner = server.owned === true;
            break;
          }
        }
        if (matchedServer) break;
      }

      if (!matchedServer) {
        // User doesn't have access - check if auto-invite is enabled
        const autoInviteResult = await this.tryAutoInvite(userInfo);
        if (autoInviteResult.invited) {
          return {
            success: false,
            error: 'An invitation to the Plex server has been sent to your email. Please accept the invitation and try logging in again.',
            invited: true
          };
        }
        // Auto-invite failed or disabled - still allow login but they'll have limited access
        // Admin can manually invite them via Plex
        console.log(`[Auth] User ${userInfo?.email || 'unknown'} doesn't have server access, allowing login anyway`);
        return {
          success: true,
          server: null,
          isOwner: false,
          needsServerAccess: true
        };
      }

      return {
        success: true,
        server: matchedServer,
        isOwner
      };
    } catch (error) {
      console.error('[Auth] Error checking server access:', error.message);
      return { success: false, error: 'Failed to verify server access' };
    }
  }

  /**
   * Try to auto-invite a user to the Plex server
   * Only works if auto_invite_enabled is true and admin token is available
   */
  async tryAutoInvite(userInfo) {
    const { db } = require('../database');

    // Check if auto-invite is enabled
    const autoInviteEnabled = getSetting('auto_invite_enabled') === 'true';
    if (!autoInviteEnabled) {
      console.log('[Auth] Auto-invite is disabled');
      return { invited: false };
    }

    if (!userInfo?.email) {
      console.log('[Auth] No user email available for auto-invite');
      return { invited: false };
    }

    // Get the admin user's Plex token (server owner)
    const adminUser = db.prepare("SELECT plex_token FROM users WHERE is_owner = 1 LIMIT 1").get();
    if (!adminUser?.plex_token) {
      console.log('[Auth] No admin token available for auto-invite');
      return { invited: false };
    }

    // Get the server's machine identifier
    const PlexService = require('./plex');
    const plexService = PlexService.fromDb();
    if (!plexService) {
      console.log('[Auth] Plex service not configured for auto-invite');
      return { invited: false };
    }

    let machineId;
    try {
      machineId = await plexService.getMachineId();
    } catch (err) {
      console.error('[Auth] Failed to get machine ID for auto-invite:', err.message);
      return { invited: false };
    }

    // Get library section IDs to share
    let librarySectionIds = [];
    const librariesSetting = getSetting('auto_invite_libraries');
    if (librariesSetting) {
      try {
        librarySectionIds = JSON.parse(librariesSetting);
      } catch (e) {
        console.warn('[Auth] Invalid auto_invite_libraries setting, sharing all libraries');
      }
    }

    // Send the invitation using Plex user ID (not email - API requires user ID)
    console.log(`[Auth] Auto-inviting ${userInfo.email} (Plex ID: ${userInfo.plex_id}) to Plex server`);
    const inviteResult = await PlexService.inviteUserToServer(
      adminUser.plex_token,
      machineId,
      userInfo.plex_id,
      librarySectionIds
    );

    if (inviteResult.success) {
      // Record the invitation
      recordPlexInvitation({
        email: userInfo.email,
        username: userInfo.username,
        plex_id: userInfo.plex_id,
        status: 'pending',
        libraries_shared: librarySectionIds.length > 0 ? librarySectionIds : null
      });

      // Log the invite
      log('info', 'auto_invite', `Auto-invited ${userInfo.email} to Plex server`, {
        email: userInfo.email,
        username: userInfo.username,
        libraries: librarySectionIds.length > 0 ? librarySectionIds : 'all'
      });
      return { invited: true, alreadyShared: inviteResult.alreadyShared };
    }

    // Record failed invitation
    recordPlexInvitation({
      email: userInfo.email,
      username: userInfo.username,
      plex_id: userInfo.plex_id,
      status: 'failed',
      libraries_shared: librarySectionIds.length > 0 ? librarySectionIds : null,
      error_message: inviteResult.error
    });

    console.error('[Auth] Auto-invite failed:', inviteResult.error);
    return { invited: false, error: inviteResult.error };
  }

  /**
   * Get the configured Plex server URL from database
   */
  async getConfiguredPlexUrl() {
    const { db } = require('../database');
    const plexService = db.prepare("SELECT url FROM services WHERE type = 'plex' AND is_active = 1 LIMIT 1").get();
    return plexService?.url || null;
  }

  // =====================================================
  // JELLYFIN AUTHENTICATION
  // =====================================================

  /**
   * Authenticate with Jellyfin using username and password
   */
  async authenticateJellyfin(serverUrl, username, password) {
    try {
      const response = await axios.post(
        `${serverUrl.replace(/\/$/, '')}/Users/AuthenticateByName`,
        {
          Username: username,
          Pw: password
        },
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Emby-Authorization': `MediaBrowser Client="Flexerr", Device="Web", DeviceId="flexerr-${Date.now()}", Version="1.0.0"`
          }
        }
      );

      return {
        success: true,
        accessToken: response.data.AccessToken,
        userId: response.data.User.Id,
        user: {
          id: response.data.User.Id,
          username: response.data.User.Name,
          isAdmin: response.data.User.Policy?.IsAdministrator || false,
          thumb: response.data.User.PrimaryImageTag
            ? `${serverUrl.replace(/\/$/, '')}/Users/${response.data.User.Id}/Images/Primary`
            : null
        },
        serverId: response.data.ServerId
      };
    } catch (error) {
      console.error('[Auth] Jellyfin authentication failed:', error.response?.data?.Message || error.message);
      return {
        success: false,
        error: error.response?.data?.Message || 'Authentication failed'
      };
    }
  }

  /**
   * Validate a Jellyfin access token
   */
  async validateJellyfinToken(serverUrl, accessToken, userId) {
    try {
      const response = await axios.get(
        `${serverUrl.replace(/\/$/, '')}/Users/${userId}`,
        {
          headers: {
            'Accept': 'application/json',
            'X-Emby-Token': accessToken
          }
        }
      );

      const user = response.data;

      return {
        success: true,
        user: {
          id: user.Id,
          username: user.Name,
          isAdmin: user.Policy?.IsAdministrator || false,
          thumb: user.PrimaryImageTag
            ? `${serverUrl.replace(/\/$/, '')}/Users/${user.Id}/Images/Primary`
            : null
        }
      };
    } catch (error) {
      console.error('[Auth] Jellyfin token validation failed:', error.message);
      return { success: false, error: 'Invalid Jellyfin token' };
    }
  }

  /**
   * Complete Jellyfin login flow
   */
  async loginJellyfin(serverUrl, username, password) {
    // Authenticate with Jellyfin
    const authResult = await this.authenticateJellyfin(serverUrl, username, password);
    if (!authResult.success) {
      return authResult;
    }

    // Get the Jellyfin media server configuration
    const jellyfinServer = getMediaServerByType('jellyfin');

    // Create or update user in database
    const user = createOrUpdateUserGeneric({
      server_user_id: authResult.userId,
      server_token: authResult.accessToken,
      username: authResult.user.username,
      thumb: authResult.user.thumb,
      is_admin: authResult.user.isAdmin,
      is_owner: authResult.user.isAdmin, // Admin is considered owner for Jellyfin
      media_server_type: 'jellyfin',
      media_server_id: jellyfinServer?.id || null
    });

    // Generate JWT tokens
    const tokens = this.generateTokensForMediaServer(user, 'jellyfin');

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        thumb: user.thumb,
        is_admin: user.is_admin === 1,
        is_owner: user.is_owner === 1
      },
      ...tokens
    };
  }

  /**
   * Generate tokens for any media server type
   */
  generateTokensForMediaServer(user, serverType = 'plex') {
    // Access token (short-lived)
    const accessToken = jwt.sign(
      {
        userId: user.id,
        serverUserId: user.plex_id, // Works for both Plex and Jellyfin
        username: user.username,
        isAdmin: Boolean(user.is_admin),
        mediaServerType: serverType
      },
      this.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Refresh token (longer-lived, stored hashed in DB)
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Store refresh token hash in database
    createSession(user.id, refreshTokenHash, expiresAt.toISOString());

    return {
      accessToken,
      refreshToken,
      expiresIn: 14400 // 4 hours in seconds
    };
  }

  /**
   * Setup first Jellyfin user (during initial setup)
   */
  async setupFirstJellyfinUser(serverUrl, username, password) {
    // Authenticate with Jellyfin
    const authResult = await this.authenticateJellyfin(serverUrl, username, password);
    if (!authResult.success) {
      return authResult;
    }

    // First user must be an admin
    if (!authResult.user.isAdmin) {
      return {
        success: false,
        error: 'First user must be a Jellyfin administrator'
      };
    }

    // Create user as admin (first user)
    const user = createOrUpdateUserGeneric({
      server_user_id: authResult.userId,
      server_token: authResult.accessToken,
      username: authResult.user.username,
      thumb: authResult.user.thumb,
      is_admin: true,
      is_owner: true,
      media_server_type: 'jellyfin'
    });

    // Generate tokens
    const tokens = this.generateTokensForMediaServer(user, 'jellyfin');

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        thumb: user.thumb,
        is_admin: true,
        is_owner: true
      },
      jellyfinAccessToken: authResult.accessToken,
      jellyfinUserId: authResult.userId,
      serverId: authResult.serverId,
      ...tokens
    };
  }

  /**
   * Determine which media server type is configured
   */
  getConfiguredMediaServerType() {
    const { db } = require('../database');

    // Check new media_servers table first
    const jellyfinServer = db.prepare("SELECT * FROM media_servers WHERE type = 'jellyfin' AND is_active = 1").get();
    if (jellyfinServer) return 'jellyfin';

    // Check legacy services table for Plex
    const plexService = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
    if (plexService) return 'plex';

    return null;
  }

  /**
   * Compare two URLs ignoring protocol and trailing slashes
   * Also handles plex.direct URLs (e.g., 192-168-4-5.xxx.plex.direct matches 192.168.4.5)
   */
  urlsMatch(url1, url2) {
    const parseUrl = (url) => {
      try {
        const parsed = new URL(url);
        const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
        return { hostname: parsed.hostname, port };
      } catch {
        const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const [hostname, port = '80'] = cleaned.split(':');
        return { hostname, port };
      }
    };

    const extractIpFromPlexDirect = (hostname) => {
      // plex.direct format: 192-168-4-5.machineid.plex.direct
      if (hostname.endsWith('.plex.direct')) {
        const ipPart = hostname.split('.')[0]; // Get first segment (e.g., "192-168-4-5")
        // Convert dashes to dots if it looks like an IP
        if (/^\d+-\d+-\d+-\d+$/.test(ipPart)) {
          return ipPart.replace(/-/g, '.');
        }
      }
      return hostname;
    };

    const p1 = parseUrl(url1);
    const p2 = parseUrl(url2);

    // Direct comparison
    if (p1.hostname === p2.hostname && p1.port === p2.port) {
      return true;
    }

    // Try extracting IP from plex.direct URLs and compare
    const ip1 = extractIpFromPlexDirect(p1.hostname);
    const ip2 = extractIpFromPlexDirect(p2.hostname);

    return ip1 === ip2 && p1.port === p2.port;
  }

  /**
   * Complete login flow - validate token, check access, create/update user
   */
  async login(plexToken) {
    // Validate token and get user info
    const validation = await this.validatePlexToken(plexToken);
    if (!validation.success) {
      return validation;
    }

    // Check server access (pass user info for auto-invite)
    const access = await this.checkServerAccess(plexToken, validation.user);
    if (!access.success) {
      return access;
    }

    const serverOwnerIsAdmin = getSetting('server_owner_is_admin') !== 'false';

    // Create or update user in database
    const user = createOrUpdateUser({
      plex_id: validation.user.plex_id,
      plex_token: plexToken,
      username: validation.user.username,
      email: validation.user.email,
      thumb: validation.user.thumb,
      is_owner: access.isOwner,
      is_admin: access.isOwner && serverOwnerIsAdmin
    });

    // Check if this user was auto-invited and mark as accepted
    if (validation.user.email) {
      markInvitationAccepted(validation.user.email, user.id);
    }

    // Generate tokens
    const tokens = this.generateTokens(user);

    const result = {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        thumb: user.thumb,
        is_admin: user.is_admin,
        is_owner: user.is_owner
      },
      ...tokens
    };

    // If user doesn't have server access, include warning
    if (access.needsServerAccess) {
      result.warning = 'You have been logged in, but the automatic Plex server invite failed. Please contact the admin to get server access.';
      result.needsServerAccess = true;
    }

    return result;
  }

  /**
   * Generate access and refresh tokens
   */
  generateTokens(user) {
    // Use the new method with plex as default for backwards compatibility
    return this.generateTokensForMediaServer(user, user.media_server_type || 'plex');
  }

  /**
   * Validate access token
   */
  validateAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      return { success: true, user: decoded };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Token expired', expired: true };
      }
      return { success: false, error: 'Invalid token' };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find session in database
    const session = getSessionByTokenHash(refreshTokenHash);

    if (!session) {
      return { success: false, error: 'Invalid refresh token' };
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      deleteSession(session.id);
      return { success: false, error: 'Refresh token expired' };
    }

    // Get user
    const user = getUserById(session.user_id);
    if (!user) {
      deleteSession(session.id);
      return { success: false, error: 'User not found' };
    }

    // Delete old session
    deleteSession(session.id);

    // Generate new tokens
    const tokens = this.generateTokens(user);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        thumb: user.thumb,
        is_admin: user.is_admin,
        is_owner: user.is_owner
      },
      ...tokens
    };
  }

  /**
   * Logout - invalidate refresh token
   */
  logout(refreshToken) {
    if (!refreshToken) return { success: true };

    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = getSessionByTokenHash(refreshTokenHash);

    if (session) {
      deleteSession(session.id);
    }

    return { success: true };
  }

  /**
   * Generic login that determines which auth flow to use
   * @param {Object} credentials
   * @param {string} credentials.type - 'plex' or 'jellyfin'
   * @param {string} credentials.plexToken - For Plex OAuth login
   * @param {string} credentials.serverUrl - For Jellyfin login
   * @param {string} credentials.username - For Jellyfin login
   * @param {string} credentials.password - For Jellyfin login
   */
  async loginGeneric(credentials) {
    const { type } = credentials;

    if (type === 'jellyfin') {
      const { serverUrl, username, password } = credentials;
      if (!serverUrl || !username || !password) {
        return { success: false, error: 'Missing Jellyfin credentials' };
      }

      // Get configured Jellyfin URL if not provided
      const configuredUrl = serverUrl || await this.getConfiguredJellyfinUrl();
      if (!configuredUrl) {
        return { success: false, error: 'Jellyfin server not configured' };
      }

      return this.loginJellyfin(configuredUrl, username, password);
    }

    // Default to Plex
    const { plexToken } = credentials;
    if (!plexToken) {
      return { success: false, error: 'Missing Plex token' };
    }

    return this.login(plexToken);
  }

  /**
   * Get the configured Jellyfin server URL
   */
  async getConfiguredJellyfinUrl() {
    const server = getMediaServerByType('jellyfin');
    return server?.url || null;
  }

  /**
   * Get current user from token
   */
  getCurrentUser(userId) {
    const user = getUserById(userId);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      thumb: user.thumb,
      is_admin: user.is_admin === 1,
      is_owner: user.is_owner === 1,
      created_at: user.created_at
    };
  }

  /**
   * Setup first user (during initial setup)
   * First user to authenticate becomes admin
   */
  async setupFirstUser(plexToken, plexUrl) {
    // Validate token
    const validation = await this.validatePlexToken(plexToken);
    if (!validation.success) {
      return validation;
    }

    // Get user's servers to verify access and ownership
    const response = await axios.get('https://plex.tv/api/v2/resources', {
      params: {
        includeHttps: 1,
        includeRelay: 1
      },
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': plexToken,
        'X-Plex-Client-Identifier': this.clientId
      }
    });

    const servers = response.data.filter(r => r.provides === 'server');

    // Find the matching server
    let isOwner = false;
    for (const server of servers) {
      const connections = server.connections || [];
      for (const conn of connections) {
        if (this.urlsMatch(conn.uri, plexUrl)) {
          isOwner = server.owned === true;
          break;
        }
      }
      if (isOwner) break;
    }

    // Create user as admin (first user)
    const user = createOrUpdateUser({
      plex_id: validation.user.plex_id,
      plex_token: plexToken,
      username: validation.user.username,
      email: validation.user.email,
      thumb: validation.user.thumb,
      is_owner: isOwner,
      is_admin: true  // First user is always admin
    });

    // Generate tokens
    const tokens = this.generateTokens(user);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        thumb: user.thumb,
        is_admin: true,
        is_owner: isOwner
      },
      ...tokens
    };
  }
}

module.exports = new AuthService();
