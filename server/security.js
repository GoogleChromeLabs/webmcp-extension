/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import crypto, { randomUUID } from 'node:crypto';

/**
 * Loads key-value pairs from a plain .env file.
 *
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function loadDotEnv(filePath) {
  /** @type {Record<string, string>} */
  const envVars = {};
  if (!fs.existsSync(filePath)) return envVars;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx > 0) {
        const key = trimmed.substring(0, equalsIdx).trim();
        let value = trimmed.substring(equalsIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.substring(1, value.length - 1);
        }
        envVars[key] = value;
      }
    }
  } catch (e) {
    console.warn('Could not load .env file:', e instanceof Error ? e.message : String(e));
  }
  return envVars;
}

/**
 * Reads one setting. A variable set in the real environment wins over the
 * same key in `.env`, the usual dotenv rule, so a one-off
 * `PORT=4000 npm run server` works without editing the file.
 *
 * @param {Record<string, string>} env Values loaded from `.env`.
 * @param {string} name
 * @returns {string | null} The trimmed value, or null when unset or blank.
 */
export function getEnv(env, name) {
  for (const raw of [process.env[name], env[name]]) {
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

/**
 * Ensures a secure WEBMCP_AUTH_TOKEN exists in .env or environment.
 * Generates and persists a random UUID token if none is present.
 * @param {Record<string, string>} env
 * @param {string} envPath
 * @returns {string}
 */
export function ensureAuthToken(env, envPath) {
  let token = getEnv(env, 'WEBMCP_AUTH_TOKEN');

  if (!token) {
    token = randomUUID();
    try {
      const line = `\n# Generated security auth token for WebMCP extension communication\nWEBMCP_AUTH_TOKEN=${token}\n`;
      if (fs.existsSync(envPath)) {
        fs.appendFileSync(envPath, line, 'utf-8');
      } else {
        fs.writeFileSync(envPath, line.trimStart(), 'utf-8');
      }
      env.WEBMCP_AUTH_TOKEN = token;
      console.log('🔐 Generated and saved new WEBMCP_AUTH_TOKEN in .env');
    } catch (e) {
      console.warn('Could not persist WEBMCP_AUTH_TOKEN in .env:', e instanceof Error ? e.message : String(e));
    }
  }

  return token;
}

/**
 * Compares two strings in constant time.
 *
 * Both values are hashed first so that `timingSafeEqual` always receives
 * equal-length buffers; this avoids leaking the length of the expected secret
 * and avoids the throw that `timingSafeEqual` raises on mismatched sizes.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const digestA = crypto.createHash('sha256').update(a, 'utf-8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf-8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Extracts a bearer/custom-header auth token from request headers.
 * @param {Record<string, any>} headers
 * @returns {string | null}
 */
function extractRequestToken(headers = {}) {
  const direct = headers['x-webmcp-auth'];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const bearer = authorization.slice(7).trim();
    if (bearer.length > 0) return bearer;
  }

  return null;
}

/**
 * Returns true when an origin points at the local loopback interface.
 * @param {string} origin
 * @returns {boolean}
 */
function isLoopbackOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Validates request origin against allowed extension origins and localhost log views.
 *
 * This is only the first of two gates. `/logs` additionally requires a valid auth
 * token or log session cookie (see `authorizeLogsRequest`), because an absent
 * Origin header is trivially forged by any local process.
 *
 * @param {string | null | undefined} origin
 * @param {string} pathname
 * @param {string | null} [allowedExtensionId]
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, pathname, allowedExtensionId = null) {
  if (pathname.startsWith('/logs')) {
    // Direct address-bar navigation sends no Origin header. Allowed here, but
    // still subject to token/session authorization.
    if (!origin) return true;
    // The dashboard's own fetch/EventSource calls are same-origin on loopback.
    if (isLoopbackOrigin(origin)) return true;
    // The extension never calls /logs, so extension origins are refused.
    return false;
  }

  // All /api endpoints strictly require a Chrome extension origin
  if (!origin || !origin.startsWith('chrome-extension://')) {
    return false;
  }

  if (allowedExtensionId) {
    return origin === `chrome-extension://${allowedExtensionId}`;
  }

  return true;
}

/**
 * Validates the auth token supplied in request headers.
 *
 * Fails closed: if the server has no configured token, every request is
 * rejected rather than silently allowing unauthenticated access.
 *
 * @param {Record<string, any>} headers
 * @param {string | null | undefined} expectedToken
 * @returns {boolean}
 */
export function validateAuthToken(headers, expectedToken) {
  if (!expectedToken) return false;
  const headerToken = extractRequestToken(headers);
  if (!headerToken) return false;
  return timingSafeEqualStrings(headerToken, expectedToken);
}

/* -------------------------------------------------------------------------- */
/* Log dashboard sessions                                                      */
/* -------------------------------------------------------------------------- */

export const LOGS_SESSION_COOKIE = 'webmcp_logs_session';
const LOGS_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** @type {Map<string, number>} sessionId -> expiry timestamp (ms) */
const logsSessions = new Map();

/**
 * Parses a Cookie request header into a plain object.
 * @param {string | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const cookies = {};
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return cookies;

  for (const part of cookieHeader.split(';')) {
    const separatorIdx = part.indexOf('=');
    if (separatorIdx < 1) continue;
    const key = part.slice(0, separatorIdx).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(separatorIdx + 1).trim());
    } catch {
      cookies[key] = part.slice(separatorIdx + 1).trim();
    }
  }

  return cookies;
}

/**
 * Creates a short-lived session for the log dashboard and prunes expired ones.
 * @param {number} [now]
 * @returns {string} the opaque session id to place in a cookie
 */
export function createLogsSession(now = Date.now()) {
  for (const [id, expiresAt] of logsSessions) {
    if (expiresAt <= now) logsSessions.delete(id);
  }
  const sessionId = crypto.randomBytes(32).toString('hex');
  logsSessions.set(sessionId, now + LOGS_SESSION_TTL_MS);
  return sessionId;
}

/**
 * Checks whether a request carries a live log dashboard session cookie.
 * @param {string | undefined} cookieHeader
 * @param {number} [now]
 * @returns {boolean}
 */
export function hasValidLogsSession(cookieHeader, now = Date.now()) {
  const sessionId = parseCookies(cookieHeader)[LOGS_SESSION_COOKIE];
  if (!sessionId) return false;

  const expiresAt = logsSessions.get(sessionId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= now) {
    logsSessions.delete(sessionId);
    return false;
  }
  return true;
}

/**
 * Builds the Set-Cookie value for a log dashboard session.
 *
 * `Secure` is deliberately omitted: the dashboard is served over plain HTTP on
 * loopback, and browsers would drop a Secure cookie on that origin.
 *
 * @param {string} sessionId
 * @param {number} [ttlMs]
 * @returns {string}
 */
export function buildLogsSessionCookie(sessionId, ttlMs = LOGS_SESSION_TTL_MS) {
  return [
    `${LOGS_SESSION_COOKIE}=${sessionId}`,
    'Path=/logs',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(ttlMs / 1000)}`,
  ].join('; ');
}

/**
 * Authorizes a request to any /logs route.
 *
 * Accepts either an existing session cookie, or a valid auth token supplied via
 * the `?token=` query parameter (how a developer bootstraps the dashboard from
 * the address bar) or the usual auth headers (for scripted access).
 *
 * @param {{ headers?: Record<string, any>, queryToken?: string | null }} request
 * @param {string | null | undefined} expectedToken
 * @returns {{ authorized: boolean, viaSession: boolean }}
 */
export function authorizeLogsRequest({ headers = {}, queryToken = null }, expectedToken) {
  if (hasValidLogsSession(headers.cookie)) {
    return { authorized: true, viaSession: true };
  }

  const suppliedToken = queryToken || extractRequestToken(headers);
  if (suppliedToken && expectedToken && timingSafeEqualStrings(suppliedToken, expectedToken)) {
    return { authorized: true, viaSession: false };
  }

  return { authorized: false, viaSession: false };
}
