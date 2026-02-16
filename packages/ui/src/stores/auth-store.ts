import { defineStore } from 'pinia';

// Cognito configuration — resolved from env or defaults
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || 'https://fable-dev.auth.us-west-2.amazoncognito.com';
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '4dbdgtv8lig9r75apo6pi5b6oc';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const LOGOUT_URI = window.location.origin;

interface AuthUser {
  userId: string;
  email: string;
  orgId: string;
}

interface AuthState {
  user: AuthUser | null;
  idToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  loading: boolean;
}

// PKCE helpers
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => chars[b % chars.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    idToken: null,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => !!state.idToken && !!state.expiresAt && Date.now() < state.expiresAt,
    isExpired: (state): boolean => !!state.expiresAt && Date.now() >= state.expiresAt,
  },

  actions: {
    /** Redirect to Cognito hosted login UI with PKCE */
    async login(): Promise<void> {
      const codeVerifier = generateRandomString(64);
      const challenge = await sha256(codeVerifier);
      const codeChallenge = base64UrlEncode(challenge);

      // Store verifier for the callback
      sessionStorage.setItem('pkce_code_verifier', codeVerifier);
      sessionStorage.setItem('pkce_redirect_path', window.location.pathname);

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
    },

    /** Handle OAuth callback — exchange code for tokens */
    async handleCallback(code: string): Promise<boolean> {
      this.loading = true;
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
      if (!codeVerifier) {
        console.error('[Auth] No PKCE code verifier found');
        this.loading = false;
        return false;
      }

      try {
        const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: codeVerifier,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error('[Auth] Token exchange failed:', err);
          return false;
        }

        const tokens = await res.json();
        this.setTokens(tokens);

        // Clean up
        sessionStorage.removeItem('pkce_code_verifier');
        return true;
      } catch (err) {
        console.error('[Auth] Token exchange error:', err);
        return false;
      } finally {
        this.loading = false;
      }
    },

    /** Set tokens and decode user info from ID token */
    setTokens(tokens: { id_token: string; access_token: string; refresh_token?: string; expires_in: number }): void {
      this.idToken = tokens.id_token;
      this.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        this.refreshToken = tokens.refresh_token;
        localStorage.setItem('fable_refresh_token', tokens.refresh_token);
      }
      this.expiresAt = Date.now() + tokens.expires_in * 1000;

      // Decode ID token payload (no verification needed — Cognito already verified it)
      try {
        const payload = JSON.parse(atob(tokens.id_token.split('.')[1]));
        this.user = {
          userId: payload.sub,
          email: payload.email || '',
          orgId: payload['custom:orgId'] || 'default',
        };
      } catch {
        console.error('[Auth] Failed to decode ID token');
      }

      // Persist minimal state for page refresh
      localStorage.setItem('fable_auth', JSON.stringify({
        idToken: this.idToken,
        accessToken: this.accessToken,
        expiresAt: this.expiresAt,
        user: this.user,
      }));
    },

    /** Refresh tokens using refresh_token grant */
    async refreshSession(): Promise<boolean> {
      const refreshToken = this.refreshToken || localStorage.getItem('fable_refresh_token');
      if (!refreshToken) return false;

      try {
        const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: CLIENT_ID,
            refresh_token: refreshToken,
          }),
        });

        if (!res.ok) {
          console.error('[Auth] Refresh failed');
          this.logout();
          return false;
        }

        const tokens = await res.json();
        // Refresh response doesn't include refresh_token — keep existing
        this.setTokens({ ...tokens, refresh_token: refreshToken });
        return true;
      } catch (err) {
        console.error('[Auth] Refresh error:', err);
        return false;
      }
    },

    /** Restore session from localStorage on app init */
    restoreSession(): void {
      const stored = localStorage.getItem('fable_auth');
      if (!stored) return;

      try {
        const data = JSON.parse(stored);
        if (data.expiresAt && Date.now() < data.expiresAt) {
          this.idToken = data.idToken;
          this.accessToken = data.accessToken;
          this.expiresAt = data.expiresAt;
          this.user = data.user;
        } else {
          // Token expired — try refresh
          this.refreshSession();
        }
      } catch {
        localStorage.removeItem('fable_auth');
      }

      this.refreshToken = localStorage.getItem('fable_refresh_token');
    },

    /** Logout — clear tokens and redirect to Cognito logout */
    logout(): void {
      this.user = null;
      this.idToken = null;
      this.accessToken = null;
      this.refreshToken = null;
      this.expiresAt = null;
      localStorage.removeItem('fable_auth');
      localStorage.removeItem('fable_refresh_token');

      // Redirect to Cognito logout
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        logout_uri: LOGOUT_URI,
      });
      window.location.href = `${COGNITO_DOMAIN}/logout?${params}`;
    },

    /** Get bearer token for API calls (auto-refresh if needed) */
    async getToken(): Promise<string | null> {
      if (!this.idToken) return null;
      if (this.isExpired) {
        const refreshed = await this.refreshSession();
        if (!refreshed) return null;
      }
      return this.idToken;
    },
  },
});
