const express = require('express');
const path = require('path');
const fs = require('fs');
const { estimateWorkoutCaloriesKcal } = require('../utils/estimateCalories');
const { createLogger } = require('../utils/logger');

const logger = createLogger('api');

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
  const normalizeSex = (value) => {
    const normalized = String(value || '').toLowerCase();
    return normalized === 'male' || normalized === 'female' ? normalized : null;
  };
  const normalizeActivityId = (value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
    if (!normalized) return null;
    if (normalized === 'run') return 'running';
    if (normalized === 'bike') return 'cycling';
    if (normalized === 'nordicwalking' || normalized === 'nordic_walk') return 'nordic_walking';
    if (normalized === 'running' || normalized === 'nordic_walking' || normalized === 'cycling') return normalized;
    return null;
  };
  // Расчёт калорий с учётом профиля:
  // - используем формулу Миффлина, если профиль заполнен,
  // - иначе применяем резервную оценку по дистанции и времени.
  const estimateMifflinWorkoutKcal = (distanceM, durationSec, profile = {}, activityId = null) => {
    const weightKg = Number(profile.weightKg);
    const age = Number(profile.age);
    const heightCm = Number(profile.heightCm);
    const sex = normalizeSex(profile.sex);
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      return estimateWorkoutCaloriesKcal(distanceM, durationSec, 70);
    }
    if (!Number.isFinite(age) || age <= 0 || !Number.isFinite(heightCm) || heightCm < 50 || heightCm > 290 || !sex) {
      return estimateWorkoutCaloriesKcal(distanceM, durationSec, weightKg);
    }
    const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + (sex === 'male' ? 5 : -161);
    const hours = Math.max(0, Number(durationSec) || 0) / 3600;
    const activityMetMap = {
      running: 9.0,
      nordic_walking: 6.5,
      cycling: 8.0
    };
    const met = activityMetMap[normalizeActivityId(activityId)] || 7.0;
    const workoutKcal = (bmr / 24) * hours * met;
    return Math.max(0, workoutKcal);
  };
  // Проба работоспособности сервиса для проверок доступности бота и мини-приложения.
  router.get('/health', (req, res) => {
    res.json({ ok: true, message: 'API is alive' });
  });

  // Вспомогательный отладочный эндпоинт (только вне production) для проверки MAX-авторизации.
  if (process.env.NODE_ENV !== 'production') {
    router.get('/auth/debug', miniAppAuth, (req, res) => {
      res.json({
        ok: true,
        chatId: String(req.chatId || ''),
        authSource: req.authSource || 'unknown',
        timestamp: new Date().toISOString()
      });
    });
  }

  // Прокси-эндпоинты 2GIS изолируют сбои внешнего API от клиентов мини-приложения.
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

  // Каталог маршрутов:
  // - /routes возвращает карточки маршрутов и geojson из сгенерированного файла,
  // - /routes/:id возвращает расширенные метаданные из routeService,
  // - /routes/:id/geojson возвращает геометрию одного маршрута.
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

    // Возвращаем поле provider в ответе, чтобы отслеживать стратегию сборки маршрута.
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
      logger.error('Failed to read routes', { error: err.message });
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
      logger.error('Route details request failed', { error: error.message, routeId: req.params.id });
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

  // API сессий и профиля защищены middleware авторизации мини-приложения.
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
      const profile = typeof userService.getUserProfile === 'function'
        ? userService.getUserProfile(chatId)
        : {};
      let normalizedActivityId = normalizeActivityId(session.activityId);
      if (!normalizedActivityId && session.plannedRouteId && typeof routeService?.findRouteById === 'function') {
        const route = routeService.findRouteById(session.plannedRouteId);
        const fallbackActivity = Array.isArray(route?.activities) ? route.activities[0] : null;
        normalizedActivityId = normalizeActivityId(fallbackActivity);
      }
      const estCaloriesKcal = Math.round(estimateMifflinWorkoutKcal(distanceM, durationSec, profile, normalizedActivityId));
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
        activityId: normalizedActivityId
      };

      userService.addSession(chatId, sessionRecord);

      return res.json({ ok: true });
    } catch (err) {
      logger.error('Session save failed', { error: err.message, chatId: req.chatId });
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
      const profile = typeof userService.getUserProfile === 'function'
        ? userService.getUserProfile(req.chatId)
        : { fullName: '', weightKg: null, age: null, heightCm: null, sex: null, hasLocation: false };
      return res.json({
        ok: true,
        sessions,
        lifetime,
        history,
        profile
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/profile', miniAppAuth, (req, res) => {
    try {
      const profile = typeof userService.getUserProfile === 'function'
        ? userService.getUserProfile(req.chatId)
        : { fullName: '', weightKg: null, age: null, heightCm: null, sex: null, hasLocation: false };
      return res.json({ ok: true, profile });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/profile', miniAppAuth, (req, res) => {
    try {
      if (typeof userService.updateUserProfile !== 'function') {
        return res.status(500).json({ ok: false, error: 'Profile update is not supported' });
      }
      const rawWeight = req.body?.weightKg;
      const rawAge = req.body?.age;
      const rawHeight = req.body?.heightCm;
      const rawSex = req.body?.sex;
      if (rawWeight !== null && rawWeight !== undefined && rawWeight !== '') {
        const w = Number(rawWeight);
        if (!Number.isFinite(w) || w < 10 || w > 250) {
          return res.status(400).json({ ok: false, error: 'Invalid weight range' });
        }
      }
      if (rawAge !== null && rawAge !== undefined && rawAge !== '') {
        const a = Number(rawAge);
        if (!Number.isFinite(a) || a < 0 || a > 110) {
          return res.status(400).json({ ok: false, error: 'Invalid age range' });
        }
      }
      if (rawHeight !== null && rawHeight !== undefined && rawHeight !== '') {
        const h = Number(rawHeight);
        if (!Number.isFinite(h) || h < 50 || h > 290) {
          return res.status(400).json({ ok: false, error: 'Invalid height range' });
        }
      }
      if (rawSex !== null && rawSex !== undefined && rawSex !== '') {
        if (!normalizeSex(rawSex)) {
          return res.status(400).json({ ok: false, error: 'Invalid sex value' });
        }
      }
      const profile = userService.updateUserProfile(req.chatId, {
        weightKg: req.body?.weightKg,
        age: req.body?.age,
        heightCm: req.body?.heightCm,
        sex: normalizeSex(req.body?.sex)
      });
      return res.json({ ok: true, profile });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/profile/location', miniAppAuth, (req, res) => {
    try {
      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ ok: false, error: 'latitude and longitude are required' });
      }
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ ok: false, error: 'Invalid coordinate range' });
      }
      userService.setLastLocation(req.chatId, {
        latitude,
        longitude,
        updatedAt: new Date().toISOString()
      });
      const profile = typeof userService.getUserProfile === 'function'
        ? userService.getUserProfile(req.chatId)
        : { fullName: '', weightKg: null, age: null, heightCm: null, sex: null, hasLocation: true };
      return res.json({ ok: true, profile });
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

  router.post('/history/save-route', miniAppAuth, (req, res) => {
    try {
      const chatId = req.chatId;
      const routeName = String(req.body?.routeName || '').trim();
      const activityId = normalizeActivityId(req.body?.activityId);
      const routeIdRaw = String(req.body?.routeId || '').trim();
      const sourceSessionId = String(req.body?.sourceSessionId || '').trim();

      if (!routeName) {
        return res.status(400).json({ ok: false, error: 'routeName is required' });
      }
      if (!activityId) {
        return res.status(400).json({ ok: false, error: 'activityId is required' });
      }

      const safeRouteId = routeIdRaw || `saved-${Date.now()}`;
      userService.addRouteToHistory(chatId, routeName, safeRouteId, {
        activityId,
        sourceSessionId: sourceSessionId || null
      });
      if (sourceSessionId && typeof userService.setSessionActivityId === 'function') {
        userService.setSessionActivityId(chatId, sourceSessionId, activityId);
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete('/history', miniAppAuth, (req, res) => {
    try {
      const routeId = String(req.query.routeId || '').trim();
      const timestamp = String(req.query.timestamp || '').trim();
      if (!routeId || !timestamp) {
        return res.status(400).json({ ok: false, error: 'routeId and timestamp are required' });
      }
      const removed = typeof userService.removeHistoryEntry === 'function'
        ? userService.removeHistoryEntry(req.chatId, routeId, timestamp)
        : false;
      if (!removed) {
        return res.status(404).json({ ok: false, error: 'History entry not found' });
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
