/**
 * Authentication Service for Flexerr
 * Handles Plex OAuth authentication and JWT token management
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getSetting, createOrUpdateUser, getUserById, getUserByPlexId, createSession, getSessionByTokenHash, deleteSession, cleanExpiredSessions } = require('../database');

const PLEX_AUTH_URL = 'https://plex.tv/api/v2';
const PLEX_PRODUCT = 'Flexerr';
const PLEX_DEVICE = 'Flexerr Server';

// JWT Configuration
// Extended access token for better UX while maintaining security
const ACCESS_TOKEN_EXPIRY = '4h';  // 4 hours for active sessions
const REFRESH_TOKEN_EXPIRY_DAYS = 30;  // 30 days for persistent login

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
   */
  async checkServerAccess(plexToken) {
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
        return { success: false, error: 'User does not have access to the configured Plex server' };
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
   * Get the configured Plex server URL from database
   */
  async getConfiguredPlexUrl() {
    const { db } = require('../database');
    const plexService = db.prepare("SELECT url FROM services WHERE type = 'plex' AND is_active = 1 LIMIT 1").get();
    return plexService?.url || null;
  }

  /**
   * Compare two URLs ignoring protocol and trailing slashes
   */
  urlsMatch(url1, url2) {
    const normalize = (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
      } catch {
        return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }
    };
    return normalize(url1) === normalize(url2);
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

    // Check server access
    const access = await this.checkServerAccess(plexToken);
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

    // Generate tokens
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
   * Generate access and refresh tokens
   */
  generateTokens(user) {
    // Access token (short-lived)
    const accessToken = jwt.sign(
      {
        userId: user.id,
        plexId: user.plex_id,
        username: user.username,
        isAdmin: Boolean(user.is_admin)
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
      expiresIn: 14400 // 4 hours in seconds (matches ACCESS_TOKEN_EXPIRY)
    };
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
