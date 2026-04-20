const { verifyMiniAppToken } = require('../utils/miniAppAuth');

function getToken(req) {
  return req.headers['x-miniapp-auth'] || req.query?.authToken || req.body?.authToken;
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

function createMiniAppAuthMiddleware(secret) {
  return (req, res, next) => {
    const chatId = getChatId(req);
    if (!chatId || !/^\d+$/.test(String(chatId))) {
      return res.status(400).json({ ok: false, error: 'Invalid chatId' });
    }

    if (!secret) {
      req.chatId = String(chatId);
      return next();
    }

    const token = getToken(req);
    const verification = verifyMiniAppToken(chatId, token, secret);
    if (!verification.ok) {
      return res.status(401).json({ ok: false, error: verification.error });
    }

    req.chatId = String(chatId);
    return next();
  };
}

module.exports = {
  createMiniAppAuthMiddleware
};
