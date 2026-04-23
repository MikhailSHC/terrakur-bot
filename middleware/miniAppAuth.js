const { verifyMiniAppToken } = require('../utils/miniAppAuth');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const logger = createLogger('miniapp-auth');

function getToken(req) {
  return req.headers['x-miniapp-auth'] || req.query?.authToken || req.body?.authToken;
}

function getMaxInitDataRaw(req) {
  const fromHeaders = req.headers['x-max-init-data'] || req.headers['x-webapp-data'];
  if (typeof fromHeaders === 'string' && fromHeaders.trim()) return fromHeaders.trim();
  if (typeof req.body?.maxInitData === 'string' && req.body.maxInitData.trim()) return req.body.maxInitData.trim();
  return '';
}

function getChatId(req) {
  if (req.body && req.body.chatId) {
    return req.body.chatId;
  }

  if (req.query && req.query.chatId) {
    return req.query.chatId;
  }

  return null;
}

function parseInitDataRaw(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  const normalized = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    if (normalized.some((entry) => entry.key === key)) return null;
    normalized.push({ key, value });
  }
  normalized.sort((a, b) => a.key.localeCompare(b.key));
  const dataCheckString = normalized.map((entry) => `${entry.key}=${entry.value}`).join('\n');
  return { hash, dataCheckString, params };
}

function decodeMaybeJson(rawValue) {
  if (typeof rawValue !== 'string') return null;
  const attempts = [rawValue];
  try {
    attempts.push(decodeURIComponent(rawValue));
  } catch {
    // ignore
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

function extractChatIdFromMaxInitData(params) {
  const directCandidates = ['chat_id', 'chatId', 'user_id', 'userId', 'chat'];
  for (const key of directCandidates) {
    const raw = params.get(key);
    if (!raw) continue;
    if (/^\d+$/.test(String(raw))) return String(raw);
    const obj = decodeMaybeJson(raw);
    const nested = obj?.id || obj?.chat_id || obj?.chatId || obj?.user_id || obj?.userId;
    if (nested && /^\d+$/.test(String(nested))) return String(nested);
  }
  const userObj = decodeMaybeJson(params.get('user'));
  const userId = userObj?.id || userObj?.user_id || userObj?.userId;
  if (userId && /^\d+$/.test(String(userId))) return String(userId);
  return null;
}

function verifyMaxInitData(rawInitData, botToken) {
  if (!botToken) {
    return { ok: false, error: 'MAX init data verification is disabled: missing BOT_TOKEN' };
  }
  const parsed = parseInitDataRaw(rawInitData);
  if (!parsed) return { ok: false, error: 'Invalid MAX init data format' };
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(parsed.dataCheckString).digest('hex');
  if (expectedHash.length !== parsed.hash.length) {
    return { ok: false, error: 'Invalid MAX init data signature' };
  }
  const signaturesMatch = crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(parsed.hash));
  if (!signaturesMatch) {
    return { ok: false, error: 'Invalid MAX init data signature' };
  }
  const authDateRaw = Number(parsed.params.get('auth_date'));
  if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) {
    return { ok: false, error: 'Missing auth_date in MAX init data' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (authDateRaw > nowSec + 300 || nowSec - authDateRaw > 24 * 60 * 60) {
    return { ok: false, error: 'MAX init data expired' };
  }
  const chatId = extractChatIdFromMaxInitData(parsed.params);
  if (!chatId) return { ok: false, error: 'Unable to extract chatId from MAX init data' };
  return { ok: true, chatId };
}

function createMiniAppAuthMiddleware(secret, botToken) {
  const isDevMode = process.env.NODE_ENV !== 'production';
  return (req, res, next) => {
    const maxInitData = getMaxInitDataRaw(req);
    if (maxInitData) {
      const verified = verifyMaxInitData(maxInitData, botToken);
      if (!verified.ok) {
        return res.status(401).json({ ok: false, error: verified.error });
      }
      req.chatId = String(verified.chatId);
      req.authSource = 'max_init_data';
      if (isDevMode) {
        logger.info('Mini-app auth resolved', {
          authSource: req.authSource,
          chatId: req.chatId,
          path: req.path
        });
      }
      return next();
    }

    const chatId = getChatId(req);
    if (!chatId || !/^\d+$/.test(String(chatId))) {
      return res.status(400).json({ ok: false, error: 'Invalid chatId' });
    }
    if (!secret) {
      req.chatId = String(chatId);
      req.authSource = 'chat_id_no_secret';
      if (isDevMode) {
        logger.warn('Mini-app auth relaxed mode', {
          authSource: req.authSource,
          chatId: req.chatId,
          path: req.path
        });
      }
      return next();
    }

    const token = getToken(req);
    const verification = verifyMiniAppToken(chatId, token, secret);
    if (!verification.ok) {
      return res.status(401).json({ ok: false, error: verification.error });
    }

    req.chatId = String(chatId);
    req.authSource = 'legacy_token';
    if (isDevMode) {
      logger.info('Mini-app auth resolved', {
        authSource: req.authSource,
        chatId: req.chatId,
        path: req.path
      });
    }
    return next();
  };
}

module.exports = {
  createMiniAppAuthMiddleware
};
