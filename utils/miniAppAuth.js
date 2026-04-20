const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function createSignature(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createMiniAppToken(chatId, secret, issuedAt = Date.now()) {
  const normalizedChatId = String(chatId);
  const payload = `${normalizedChatId}:${issuedAt}`;
  const signature = createSignature(secret, payload);
  return `${issuedAt}.${signature}`;
}

function verifyMiniAppToken(chatId, token, secret, now = Date.now()) {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'Missing auth token' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'Invalid auth token format' };
  }

  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
    return { ok: false, error: 'Invalid auth token timestamp' };
  }

  if (now - issuedAt > TOKEN_TTL_MS) {
    return { ok: false, error: 'Auth token expired' };
  }

  const normalizedChatId = String(chatId);
  const payload = `${normalizedChatId}:${issuedAt}`;
  const expected = createSignature(secret, payload);
  const actual = parts[1];

  if (expected.length !== actual.length) {
    return { ok: false, error: 'Invalid auth token signature' };
  }

  const isValid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  return isValid
    ? { ok: true }
    : { ok: false, error: 'Invalid auth token signature' };
}

module.exports = {
  createMiniAppToken,
  verifyMiniAppToken,
  TOKEN_TTL_MS
};
