const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createApiRouter } = require('../routes/apiRoutes');

function createApp({ userService, routeService, miniAppAuth, config }) {
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
  app.get('/mini-app/runtime-config.js', (_req, res) => {
    const runtimeConfig = {
      DGIS_API_KEY: config?.DGIS_API_KEY || ''
    };
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.send(`window.__MINI_APP_RUNTIME__ = ${JSON.stringify(runtimeConfig)};`);
  });
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
