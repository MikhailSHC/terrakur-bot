const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createApiRouter } = require('../routes/apiRoutes');

function createApp({ userService, routeService, miniAppAuth }) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: { ok: false, error: 'Too many requests, try later' }
    })
  );
  app.use(express.json());
  const publicRoot = path.join(__dirname, '..', 'public');
  app.use(
    express.static(publicRoot, {
      setHeaders(res, filePath) {
        const rel = path.relative(publicRoot, filePath);
        if (rel.startsWith(`mini-app${path.sep}`) && /\.(html|js)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          res.setHeader('Pragma', 'no-cache');
        }
      }
    })
  );

  app.use(
    '/api',
    createApiRouter({
      userService,
      routeService,
      miniAppAuth
    })
  );

  return app;
}

module.exports = {
  createApp
};
