const express = require('express');
const path = require('path');
const fs = require('fs');
const { estimateWorkoutCaloriesKcal } = require('../utils/estimateCalories');

function readGeoJsonRoutes(projectRoot) {
  const geojsonPath = path.join(projectRoot, 'public/mini-app/routes.geojson');
  if (!fs.existsSync(geojsonPath)) {
    return null;
  }

  const data = fs.readFileSync(geojsonPath, 'utf8');
  return JSON.parse(data);
}

function createApiRouter({ userService, routeService, miniAppAuth, config }) {
  const router = express.Router();
  const dgisApiKey = typeof config?.DGIS_API_KEY === 'string' ? config.DGIS_API_KEY.trim() : '';

  router.get('/health', (req, res) => {
    res.json({ ok: true, message: 'API is alive' });
  });

  router.get('/geocode', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ ok: false, error: 'q is required' });
    }
    if (!dgisApiKey) {
      return res.status(503).json({ ok: false, error: 'DGIS_API_KEY is not configured' });
    }
    try {
      const url = new URL('https://catalog.api.2gis.com/3.0/items/geocode');
      url.searchParams.set('q', query);
      url.searchParams.set('fields', 'items.point,items.address_name,items.full_name');
      url.searchParams.set('key', dgisApiKey);
      url.searchParams.set('page_size', '5');
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        return res.status(502).json({ ok: false, error: '2GIS geocoder request failed' });
      }
      const data = await response.json();
      const items = Array.isArray(data?.result?.items)
        ? data.result.items.map((item) => ({
            lon: item?.point?.lon,
            lat: item?.point?.lat,
            title: item?.full_name || item?.address_name || null
          })).filter((item) => Number.isFinite(item.lon) && Number.isFinite(item.lat))
        : [];
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reverse-geocode', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, error: 'lat and lon are required' });
    }
    if (!dgisApiKey) {
      return res.status(503).json({ ok: false, error: 'DGIS_API_KEY is not configured' });
    }
    try {
      const url = new URL('https://catalog.api.2gis.com/3.0/items/geocode');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('fields', 'items.address_name,items.full_name,items.point');
      url.searchParams.set('key', dgisApiKey);
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        return res.status(502).json({ ok: false, error: '2GIS reverse geocoder request failed' });
      }
      const data = await response.json();
      const first = Array.isArray(data?.result?.items) ? data.result.items[0] : null;
      return res.json({
        ok: true,
        item: first
          ? {
              lon: first?.point?.lon,
              lat: first?.point?.lat,
              title: first?.full_name || first?.address_name || null
            }
          : null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/routes/build-custom', miniAppAuth, (req, res) => {
    const waypoints = Array.isArray(req.body?.waypoints) ? req.body.waypoints : [];
    const providerRaw = String(req.body?.provider || 'legacy').toLowerCase();
    const provider = providerRaw === '2gis' ? '2gis' : 'legacy';
    const normalized = waypoints
      .map((p) => [Number(p?.lon), Number(p?.lat)])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

    if (normalized.length < 2) {
      return res.status(400).json({ ok: false, error: 'At least 2 waypoints are required' });
    }

    // Compatibility-safe first step: keep your current logic/format,
    // but explicitly mark provider to allow transparent 2GIS rollout.
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: normalized
          },
          properties: {
            provider,
            source: provider === '2gis' ? '2gis-compatible' : 'legacy-compatible'
          }
        }
      ]
    };

    return res.json({
      ok: true,
      provider,
      geojson
    });
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
      const durationSec = Number(session.durationSec) || 0;
      const distanceM = Number(session.distanceM) || 0;
      const estCaloriesKcal = Math.round(estimateWorkoutCaloriesKcal(distanceM, durationSec));
      const sessionRecord = {
        id: sessionId,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        durationSec,
        distanceM,
        avgPaceSecPerKm: session.avgPaceSecPerKm,
        estCaloriesKcal,
        geojson: session.geojson,
        mode: session.mode,
        plannedRouteId: session.plannedRouteId || null,
        activityId:
          typeof session.activityId === 'string' && session.activityId.length > 0
            ? session.activityId
            : null
      };

      userService.addSession(chatId, sessionRecord);

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
      const lifetime = userService.getLifetimeStats(req.chatId);
      const user = typeof userService.getUserSession === 'function'
        ? userService.getUserSession(req.chatId)
        : null;
      const history = Array.isArray(user?.history) ? user.history : [];
      return res.json({
        ok: true,
        sessions,
        lifetime,
        history,
        profile: {
          fullName: typeof user?.fullName === 'string' ? user.fullName : ''
        }
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete('/sessions/:id', miniAppAuth, (req, res) => {
    try {
      const sessionId = req.params.id;
      if (!sessionId) {
        return res.status(400).json({ ok: false, error: 'Session id is required' });
      }
      const removed = userService.removeSessionById(req.chatId, sessionId);
      if (!removed) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
