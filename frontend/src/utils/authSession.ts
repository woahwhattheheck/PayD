export const AUTH_TOKEN_KEY = 'payd_auth_token';
const AUTH_RETURN_TO_KEY = 'payd_auth_return_to';

type JwtPayload = {
  exp?: unknown;
  typ?: unknown;
};

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(padded));
    return typeof payload === 'object' && payload !== null ? (payload as JwtPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Frontend session eligibility only. API authorization remains authoritative.
 * Mirrors backend authentication: legacy tokens without a typ claim remain valid,
 * while explicit non-access token types are rejected before protected UI renders.
 */
export function hasActiveAccessToken(): boolean {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return false;

  const payload = decodeJwtPayload(token);
  const active =
    payload !== null &&
    (payload.typ === undefined || payload.typ === 'access') &&
    typeof payload.exp === 'number' &&
    Number.isFinite(payload.exp) &&
    payload.exp * 1000 > Date.now();

  if (!active) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
  return active;
}

export function normalizeAuthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

export function rememberAuthReturnPath(value: unknown): void {
  try {
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, normalizeAuthReturnPath(value));
  } catch {
    // Storage can be unavailable in hardened browser modes. Root is a safe fallback.
  }
}

export function readAuthReturnPath(): string {
  try {
    return normalizeAuthReturnPath(sessionStorage.getItem(AUTH_RETURN_TO_KEY));
  } catch {
    return '/';
  }
}

export function consumeAuthReturnPath(): string {
  const target = readAuthReturnPath();
  try {
    sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
  } catch {
    // Nothing else is required; navigation can still use the normalized target.
  }
  return target;
}
