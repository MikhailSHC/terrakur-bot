const express = require('express');
const path = require('path');
const fs = require('fs');

function readGeoJsonRoutes(projectRoot) {
  const geojsonPath = path.join(projectRoot, 'public/mini-app/routes.geojson');
  if (!fs.existsSync(geojsonPath)) {
    return null;
  }

  const data = fs.readFileSync(geojsonPath, 'utf8');
  return JSON.parse(data);
}

function createApiRouter({ userService, routeService, userRoutesService, miniAppAuth }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ ok: true, message: 'API is alive' });
  });

  router.get('/routes', (req, res) => {
    try {
      const geojson = readGeoJsonRoutes(process.cwd());
      const systemRoutes = geojson
        ? geojson.features.map((feature) => ({
            id: feature.properties.id,
            name: feature.properties.name,
            type: 'system',
            geojson: feature
          }))
        : [];

      res.json({ ok: true, routes: systemRoutes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/routes/:id', (req, res) => {
    try {
      const routeId = req.params.id;
      const route = routeService.getRouteByIdForApi(routeId);
      if (!route) {
        return res.status(404).json({ ok: false, error: 'Route not found' });
      }
      return res.json({ ok: true, route });
    } catch (error) {
      console.error('❌ API /api/routes/:id error:', error);
      return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  router.get('/routes/:id/geojson', (req, res) => {
    try {
      const id = req.params.id;
      const geojson = readGeoJsonRoutes(process.cwd());
      if (!geojson) {
        return res.status(404).json({ ok: false, error: 'Routes file not found' });
      }
      const feature = geojson.features.find((f) => f.properties.id === id);
      if (!feature) return res.status(404).json({ ok: false, error: 'Route not found' });
      return res.json({ ok: true, route: feature });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/sessions', miniAppAuth, (req, res) => {
    const chatId = req.chatId;
    const { session } = req.body;

    if (!session || typeof session !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid session payload' });
    }
    if (!session.mode || !['free_run', 'planned_route'].includes(session.mode)) {
      return res.status(400).json({ ok: false, error: 'Invalid session mode' });
    }

    try {
      const sessionId = session.sessionId || Date.now().toString();
      const sessionRecord = {
        id: sessionId,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        durationSec: session.durationSec,
        distanceM: session.distanceM,
        avgPaceSecPerKm: session.avgPaceSecPerKm,
        geojson: session.geojson,
        mode: session.mode,
        plannedRouteId: session.plannedRouteId || null,
        userRouteId: session.userRouteId || null
      };

      userService.addSession(chatId, sessionRecord);

      if (session.mode === 'free_run' && session.geojson && session.geojson.features?.length) {
        const line = session.geojson.features[0];
        if (line.geometry && Array.isArray(line.geometry.coordinates)) {
          const coords = line.geometry.coordinates;
          if (coords.length > 1) {
            const start = coords[0];
            const end = coords[coords.length - 1];
            const center = coords[Math.floor(coords.length / 2)];
            const userRoute = {
              id: `user_${sessionId}`,
              name: session.name || `Мой маршрут ${new Date(session.startedAt).toLocaleString()}`,
              createdAt: session.startedAt,
              distanceM: session.distanceM,
              durationSec: session.durationSec,
              avgPaceSecPerKm: session.avgPaceSecPerKm,
              start: { lon: start[0], lat: start[1] },
              end: { lon: end[0], lat: end[1] },
              center: { lon: center[0], lat: center[1] },
              geojson: session.geojson
            };

            userService.addUserRoute(chatId, userRoute);
            userService.addRouteToHistory(chatId, userRoute.name, userRoute.id);
          }
        }
      }

      if (session.mode === 'planned_route' && session.plannedRouteId) {
        const route = routeService.findRouteById(session.plannedRouteId);
        const historyRouteName = route ? route.name : `Маршрут ${session.plannedRouteId}`;
        userService.addRouteToHistory(chatId, historyRouteName, session.plannedRouteId);
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/sessions', miniAppAuth, (req, res) => {
    try {
      const sessions = userService.getSessions(req.chatId);
      return res.json({ ok: true, sessions });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/user-routes/:id', miniAppAuth, (req, res) => {
    try {
      const routeId = req.params.id;
      if (!routeId || typeof routeId !== 'string') {
        return res.status(400).json({ ok: false, error: 'Invalid routeId' });
      }

      const route = userRoutesService.getUserRouteById(req.chatId, routeId);
      if (!route) {
        return res.status(404).json({ ok: false, error: 'User route not found' });
      }
      return res.json({ ok: true, route });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
