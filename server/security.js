/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * Loads key-value pairs from a plain .env file.
 */
export function loadDotEnv(filePath) {
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
    console.warn('Could not load .env file:', e.message);
  }
  return envVars;
}

/**
 * Ensures a secure WEBMCP_AUTH_TOKEN exists in .env or environment.
 * Generates and persists a random UUID token if none is present.
 * @param {Record<string, string>} env
 * @param {string} envPath
 * @returns {string}
 */
export function ensureAuthToken(env, envPath) {
  let token =
    env.WEBMCP_AUTH_TOKEN ||
    env.AUTH_TOKEN ||
    process.env.WEBMCP_AUTH_TOKEN ||
    process.env.AUTH_TOKEN;

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
      console.warn('Could not persist WEBMCP_AUTH_TOKEN in .env:', e.message);
    }
  }

  return token;
}

/**
 * Validates request origin against allowed extension origins and localhost log views.
 * @param {string | null | undefined} origin
 * @param {string} pathname
 * @param {string | null} [allowedExtensionId]
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, pathname, allowedExtensionId = null) {
  // Allow direct browser navigations and same-origin dashboard calls for /logs
  if (pathname.startsWith('/logs')) {
    if (!origin) return true; // Direct address bar navigation
    try {
      const originUrl = new URL(origin);
      if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
        return true;
      }
    } catch {
      // Invalid URL string
    }
    if (origin.startsWith('chrome-extension://')) {
      if (allowedExtensionId) {
        return origin === `chrome-extension://${allowedExtensionId}`;
      }
      return true;
    }
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
 * @param {Record<string, any>} headers
 * @param {string | null | undefined} expectedToken
 * @returns {boolean}
 */
export function validateAuthToken(headers, expectedToken) {
  if (!expectedToken) return true;
  const headerToken =
    headers['x-webmcp-auth'] ||
    (headers.authorization?.startsWith('Bearer ')
      ? headers.authorization.slice(7).trim()
      : null);

  return headerToken === expectedToken;
}

/**
 * Sets restricted CORS headers tailored to the verified origin.
 * @param {any} res
 * @param {string} [origin]
 */
export function setCorsHeaders(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WebMCP-Auth, Authorization');
}
