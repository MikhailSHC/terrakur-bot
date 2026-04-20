const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createApiRouter } = require('../routes/apiRoutes');

function createApp({ userService, routeService, userRoutesService, miniAppAuth }) {
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
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(
    '/api',
    createApiRouter({
      userService,
      routeService,
      userRoutesService,
      miniAppAuth
    })
  );

  return app;
}

module.exports = {
  createApp
};
