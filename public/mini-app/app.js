// app.js – TerraKur беговой трекер (улучшенный GPS-фильтр)



let map;

let userMarker;
let userMarkerEl = null;

let watchId = null;
let passiveWatchId = null;



// Состояние тренировки

let isTracking = false;

let isPaused = false;

let trackPoints = [];      // { lat, lng, timestamp, accuracy }

let totalDistanceM = 0;    // накопленная дистанция в метрах

let startTime = null;

let pausedDuration = 0;

let pauseStart = null;

let lastSavedPoint = null;

/** Сглаженная позиция конца трека только для отрисовки (дистанция — по trackPoints) */
let trailDisplayLat = null;
let trailDisplayLng = null;
// Smoothness tuning (prev: alpha=0.38, lag=42) kept for quick rollback.
const TRAIL_DISPLAY_SMOOTH_ALPHA = 0.52;
const TRAIL_DISPLAY_MAX_LAG_M = 24;

let startMarker = null;    // маркер точки старта маршрута
let finishMarker = null;   // маркер точки финиша маршрута



// (опционально) запланированный маршрут

let plannedRoute = null;

let plannedStart = null;      // точка старта готового маршрута [lon, lat]
let plannedFinish = null;     // точка финиша готового маршрута [lon, lat]

let hasReachedStart = false;  // достиг ли пользователь старта
let hasReachedFinish = false; // достиг ли пользователь финиша

const START_RADIUS_M = 20;    // радиус в метрах для старта
const FINISH_RADIUS_M = 20;   // радиус в метрах для финиша



// Отслеживание прогресса по маршруту

let routeProgress = {

  currentIndex: 0,      // текущий индекс точки маршрута

  completedSegments: 0,  // сколько сегментов завершено

  totalSegments: 0,       // всего сегментов в маршруте

  isOnRoute: false,        // находится ли пользователь на маршруте

  lastProgressUpdate: 0,  // время последнего обновления прогресса
  passedCoords: []

};

const PROGRESS_UPDATE_INTERVAL_MS = 350;

/** Источники GeoJSON: пройденный участок (сплошной зелёный) и остаток (синий пунктир) */
const PLANNED_ROUTE_DONE_SOURCE = 'planned-route-done';
const PLANNED_ROUTE_REMAINING_SOURCE = 'planned-route-remaining';
/** Зелёная «тропа» отображается после прохода хотя бы одного сегмента полилинии */
const ROUTE_PROGRESS_MIN_VERTEX_FOR_GREEN = 1;

/** Пунктир от текущей позиции до точки старта (скрывается в зоне старта) */
const NAV_TO_START_SOURCE = 'nav-to-start-line';
const cinematicDemoEnabled = /(?:\?|&)demo=(?:cinematic|1|true)(?:&|$)/i.test(window.location.search);


// Camera tuning (prev: interval=2500, minMove=8) kept for quick rollback.
const CAMERA_UPDATE_INTERVAL_MS = cinematicDemoEnabled ? 700 : 1200;
const CAMERA_MIN_MOVE_M = cinematicDemoEnabled ? 2 : 4;
// Replay tuning (prev: duration=6000, step interval=60ms) kept for quick rollback.
const REPLAY_DURATION_MS = cinematicDemoEnabled ? 9800 : 7600;



// DOM-элементы

const statsPanel   = document.getElementById('statsPanel');

const timeEl       = document.getElementById('time');

const distanceEl   = document.getElementById('distance');

const estCaloriesEl = document.getElementById('estCalories');

const statusDiv    = document.getElementById('status');

const startBtn     = document.getElementById('startBtn');
const stopBtnEl    = document.getElementById('stopBtn');
const controlsEl   = document.querySelector('.controls');

// const routesBtn    = document.getElementById('routesBtn');

// const historyBtn   = document.getElementById('historyBtn');



// Параметры из URL

const urlParams   = new URLSearchParams(window.location.search);

const routeId     = urlParams.get('routeId');       // системный маршрут

const chatId      = urlParams.get('chatId') || 'test_user';
const authToken   = urlParams.get('authToken') || '';
const activityIdFromUrl = urlParams.get('activityId');
const mapProvider = (urlParams.get('mapProvider') || '').toLowerCase();
const dgisKeyFromUrl = (urlParams.get('dgisKey') || '').trim();
const miniAppRuntime = window.__MINI_APP_RUNTIME__ || {};
const dgisApiKeyFromRuntime = typeof miniAppRuntime.DGIS_API_KEY === 'string'
  ? miniAppRuntime.DGIS_API_KEY.trim()
  : '';
const dgisApiKey = dgisApiKeyFromRuntime || dgisKeyFromUrl;
const dgisPilotRequested = mapProvider === '2gis' && routeId === 'kholodnye-rodniki';
const dgisRasterEnabled = dgisPilotRequested && Boolean(dgisApiKey);

/** Тест без прогулки: добавьте в URL `&simulate=1` (вместе с routeId). */
const simulateEnabled = (() => {
  if (typeof TerraSimHelpers !== 'undefined' && TerraSimHelpers.resolveSimulateEnabled) {
    return TerraSimHelpers.resolveSimulateEnabled(window.location.search);
  }
  return urlParams.get('simulate') === '1';
})();
let simulatedGeo = null; // { lat, lng } — подмена позиции, пока включена симуляция
let simRouteStepIndex = 0;



let sessionMode;

if (routeId) {

  sessionMode = 'planned_route';

} else {

  sessionMode = 'free_run';

}

function getAuthHeaders() {
  if (!authToken) return {};
  return { 'x-miniapp-auth': authToken };
}

function syncStopButtonVisibility() {
  if (!stopBtnEl) return;
  const show =
    isTracking &&
    (sessionMode !== 'planned_route' || hasReachedStart);
  stopBtnEl.classList.toggle('hidden', !show);
}



// === GPS FILTERING ===



// Base parameters for filtering GPS

const BASE_MIN_DISTANCE_METERS   = 3;    // smoother visual track updates

const BASE_MAX_JUMP_METERS       = 60;   // outlier if too far in short interval

const BASE_MAX_ACCURACY_METERS   = 30;   // discard points with accuracy worse than 30 m

const BASE_MAX_SPEED_M_S         = 7;    // ~25 km/h - everything above is considered outlier (for running/jogging)



// Adaptive filtering state

let recentSpeeds = [];          // last few speed measurements for averaging

const SPEED_HISTORY_SIZE = 5;   // how many recent speeds to average

const LOW_SPEED_THRESHOLD_M_S = 2; // m/s - low-speed profile for stricter GPS filtering

// Таймер для UI

let uiTimerId = null;
let lastFlyTime = 0;
let lastCameraCenter = null;
let isFollowingUser = true;

let routeProgressEl = null;
let recenterBtn = null;

let lastKnownPosition = null;

let autoPausedBySystem = false;
let lastRawPoint = null;
let lastHeadingDeg = null;
let replayPanelEl = null;
let isReplayRunning = false;
let isReplayViewLocked = false;

const REPLAY_SOURCE_ID = 'run-replay-source';
const REPLAY_LAYER_ID = 'run-replay-line';
let redrawQueued = false;
let replayTimerId = null;
let cinematicPlaybackRafId = null;



// Для статуса по старту

let lastStartStatus = null;   // последнее текстовое состояние про "подойдите к старту"



// === ИНИЦИАЛИЗАЦИЯ КАРТЫ ===



function initMap() {
  const rasterTiles = dgisRasterEnabled
    ? [
        `https://tile0.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`,
        `https://tile1.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`,
        `https://tile2.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`
      ]
    : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];

  map = new maplibregl.Map({

    container: 'map',
    antialias: cinematicDemoEnabled,

    style: {

      version: 8,

      sources: {

        osm: {

          type: 'raster',

          tiles: rasterTiles,

          tileSize: 256

        }

      },

      layers: [

        { id: 'osm', type: 'raster', source: 'osm' }

      ]

    },

    center: [42.7165, 43.9071],

    zoom: 13,
    pitch: cinematicDemoEnabled ? 42 : 0,
    bearing: 0

  });



  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.on('dragstart', () => {
    isFollowingUser = false;
  });



  map.on('load', () => {
    if (dgisPilotRequested && !dgisRasterEnabled) {
      statusDiv.innerText = '2GIS не включен: ключ не найден (DGIS_API_KEY/dgisKey). Используется стандартная карта.';
    } else if (dgisRasterEnabled) {
      statusDiv.innerText = '2GIS pilot mode enabled';
    }

    map.addSource('run-track', {

      type: 'geojson',

      data: { type: 'FeatureCollection', features: [] }

    });



    map.addLayer({

      id: 'run-line',

      type: 'line',

      source: 'run-track',

      paint: {

        'line-color': '#ff4d4d',

        'line-width': cinematicDemoEnabled ? 10 : 8,
        'line-opacity': cinematicDemoEnabled ? 0.96 : 0.92

      }

    });
    if (cinematicDemoEnabled) {
      map.addLayer({
        id: 'run-line-glow',
        type: 'line',
        source: 'run-track',
        paint: {
          'line-color': '#f97316',
          'line-width': 16,
          'line-opacity': 0.2,
          'line-blur': 0.9
        }
      }, 'run-line');
    }

    ensureNavToStartLayer();



    if (routeId) {

      // системный маршрут из routes.geojson

      loadPlannedRoute(routeId);

    } else {

      // свободный трек

      getUserLocation();

    }

  });

}

function ensureCinematicStyles() {
  if (!cinematicDemoEnabled || document.getElementById('terraCinematicStyles')) return;
  const style = document.createElement('style');
  style.id = 'terraCinematicStyles';
  style.textContent = `
    @keyframes terraPulse {
      0% { transform: scale(0.9); opacity: 0.52; }
      70% { transform: scale(1.7); opacity: 0; }
      100% { transform: scale(1.7); opacity: 0; }
    }
    .terra-user-marker-core { position: relative; }
    .terra-user-marker-core::before {
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid rgba(74, 222, 128, 0.85);
      animation: terraPulse 1.6s ease-out infinite;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function ensureUiEnhancements() {
  if (!routeProgressEl) {
    routeProgressEl = document.createElement('div');
    routeProgressEl.id = 'routeProgress';
    routeProgressEl.style.cssText = cinematicDemoEnabled
      ? 'position:fixed;top:96px;left:14px;right:14px;z-index:3;background:rgba(8,14,22,0.62);backdrop-filter:blur(8px);color:#fff;padding:10px 13px;border-radius:18px;font-size:12px;display:none;border:1px solid rgba(255,255,255,0.16);'
      : 'position:fixed;top:104px;left:16px;right:16px;z-index:3;background:rgba(0,0,0,0.72);color:#fff;padding:8px 12px;border-radius:16px;font-size:12px;display:none;';
    document.body.appendChild(routeProgressEl);
  }

  if (!recenterBtn) {
    recenterBtn = document.createElement('button');
    recenterBtn.id = 'recenterBtn';
    recenterBtn.textContent = '📍 Центр';
    recenterBtn.style.cssText = cinematicDemoEnabled
      ? 'position:fixed;bottom:172px;right:16px;z-index:3;background:rgba(12,18,28,0.72);border:1px solid rgba(255,255,255,0.2);backdrop-filter:blur(8px);border-radius:28px;padding:9px 14px;font-size:13px;font-weight:600;color:#fff;'
      : 'position:fixed;bottom:160px;right:16px;z-index:3;background:rgba(0,0,0,0.75);border:none;border-radius:28px;padding:8px 14px;font-size:13px;font-weight:600;color:#fff;';
    recenterBtn.onclick = () => {
      isFollowingUser = true;
      if (lastKnownPosition) {
        const center = [lastKnownPosition.longitude, lastKnownPosition.latitude];
        map.easeTo({
          center,
          zoom: cinematicDemoEnabled ? 17.2 : 17,
          duration: cinematicDemoEnabled ? 760 : 550,
          pitch: cinematicDemoEnabled ? 46 : 0,
          bearing: cinematicDemoEnabled && typeof lastHeadingDeg === 'number' ? lastHeadingDeg : 0
        });
      }
    };
    document.body.appendChild(recenterBtn);
  }

  if (!replayPanelEl) {
    replayPanelEl = document.createElement('div');
    replayPanelEl.id = 'replayPanel';
    replayPanelEl.style.cssText = cinematicDemoEnabled
      ? 'position:fixed;left:0;right:0;bottom:0;z-index:5;background:linear-gradient(180deg,rgba(12,18,30,0.82) 0%,rgba(8,10,14,0.92) 100%);backdrop-filter:blur(10px);color:#fff;border-radius:22px 22px 0 0;padding:16px 16px calc(18px + env(safe-area-inset-bottom));display:none;box-shadow:0 -14px 40px rgba(0,0,0,0.5);max-height:52vh;overflow:auto;border-top:1px solid rgba(255,255,255,0.12);'
      : 'position:fixed;left:0;right:0;bottom:0;z-index:5;background:rgba(8,10,14,0.92);color:#fff;border-radius:18px 18px 0 0;padding:14px 14px calc(16px + env(safe-area-inset-bottom));display:none;box-shadow:0 -8px 26px rgba(0,0,0,0.45);max-height:46vh;overflow:auto;';
    document.body.appendChild(replayPanelEl);
  }
}

function setPostRunUiMode(enabled) {
  if (controlsEl) {
    controlsEl.style.display = enabled ? 'none' : '';
  }
  if (recenterBtn) {
    recenterBtn.style.display = enabled ? 'none' : '';
  }
  if (statusDiv) {
    statusDiv.style.display = enabled ? 'none' : '';
  }
}

function getRouteLineCoordinates() {
  if (!plannedRoute) return [];
  if (plannedRoute.geometry && Array.isArray(plannedRoute.geometry.coordinates)) {
    return plannedRoute.geometry.coordinates;
  }
  if (
    plannedRoute.features &&
    plannedRoute.features[0] &&
    plannedRoute.features[0].geometry &&
    Array.isArray(plannedRoute.features[0].geometry.coordinates)
  ) {
    return plannedRoute.features[0].geometry.coordinates;
  }
  return [];
}

function getRouteNameSafe() {
  if (plannedRoute?.properties?.name) return plannedRoute.properties.name;
  if (plannedRoute?.features?.[0]?.properties?.name) return plannedRoute.features[0].properties.name;
  return 'Маршрут';
}

function removeLegacyPlannedRouteLayerIfAny() {
  if (!map) return;
  if (map.getLayer('planned-route-line')) {
    map.removeLayer('planned-route-line');
  }
  if (map.getSource('planned-route')) {
    map.removeSource('planned-route');
  }
}

function ensurePlannedRouteProgressLayers() {
  if (!map) return;
  if (map.getSource(PLANNED_ROUTE_REMAINING_SOURCE)) return;

  map.addSource(PLANNED_ROUTE_REMAINING_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addSource(PLANNED_ROUTE_DONE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: 'planned-route-done-line',
    type: 'line',
    source: PLANNED_ROUTE_DONE_SOURCE,
    paint: {
      'line-color': '#22c55e',
      'line-width': 6,
      'line-opacity': 0.92
    }
  });

  map.addLayer({
    id: 'planned-route-remaining-line',
    type: 'line',
    source: PLANNED_ROUTE_REMAINING_SOURCE,
    paint: {
      'line-color': '#3b82f6',
      'line-width': 4,
      'line-dasharray': [2, 2]
    }
  });
}

function setGeoJSONLineSource(sourceId, coordinates) {
  if (!map || !map.getSource(sourceId)) return;
  if (!coordinates || coordinates.length < 2) {
    map.getSource(sourceId).setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  map.getSource(sourceId).setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {}
      }
    ]
  });
}

function applyPlannedRouteProgressToMap(progressVertexIndex) {
  const coords = getRouteLineCoordinates();
  if (coords.length < 2 || !map?.getSource(PLANNED_ROUTE_DONE_SOURCE)) return;

  const idx = Math.min(Math.max(0, progressVertexIndex), coords.length - 1);
  const showGreen = idx >= ROUTE_PROGRESS_MIN_VERTEX_FOR_GREEN;

  if (!showGreen) {
    setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, []);
    setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, coords);
    return;
  }

  const doneCoords = coords.slice(0, idx + 1);
  const remainingCoords = coords.slice(idx);

  setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, doneCoords.length >= 2 ? doneCoords : []);
  if (remainingCoords.length >= 2) {
    setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, remainingCoords);
  } else {
    setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, []);
  }
}

function finalizePlannedRouteMapProgress() {
  if (!map?.getSource(PLANNED_ROUTE_DONE_SOURCE)) return;
  const hasActualPassed = Array.isArray(routeProgress.passedCoords) && routeProgress.passedCoords.length >= 2;

  if (hasActualPassed) {
    setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, routeProgress.passedCoords);
  } else {
    const coords = getRouteLineCoordinates();
    setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, coords);
  }
  setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, []);
  clearNavToStartLine();
}

function ensureNavToStartLayer() {
  if (!map || map.getSource(NAV_TO_START_SOURCE)) return;
  map.addSource(NAV_TO_START_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'nav-to-start-line-layer',
    type: 'line',
    source: NAV_TO_START_SOURCE,
    paint: {
      'line-color': '#f97316',
      'line-width': 4,
      'line-dasharray': [0.4, 1.2],
      'line-opacity': 0.9
    }
  });
}

function clearNavToStartLine() {
  if (!map?.getSource(NAV_TO_START_SOURCE)) return;
  map.getSource(NAV_TO_START_SOURCE).setData({ type: 'FeatureCollection', features: [] });
}

function updateNavToStartLineIfNeeded(userLat, userLng) {
  if (!map) return;
  ensureNavToStartLayer();
  if (
    sessionMode !== 'planned_route' ||
    !plannedStart ||
    hasReachedStart ||
    isTracking
  ) {
    clearNavToStartLine();
    return;
  }
  const a = userLng;
  const b = userLat;
  const c = plannedStart[0];
  const d = plannedStart[1];
  if (haversineDistance(b, a, d, c) < 2) {
    clearNavToStartLine();
    return;
  }
  setGeoJSONLineSource(NAV_TO_START_SOURCE, [
    [a, b],
    [c, d]
  ]);
}

function updateGPSQuality(_accuracy) {
  // intentionally hidden in MVP UI to reduce visual noise
}

function smoothCameraFollow(center, now) {
  if (!map || !isFollowingUser) return;
  const cinematicBearing = typeof lastHeadingDeg === 'number' ? lastHeadingDeg : 0;
  if (!lastCameraCenter) {
    map.easeTo({
      center,
      zoom: cinematicDemoEnabled ? 17.2 : 17,
      duration: cinematicDemoEnabled ? 780 : 500,
      pitch: cinematicDemoEnabled ? 46 : 0,
      bearing: cinematicDemoEnabled ? cinematicBearing : 0,
      easing: (t) => (cinematicDemoEnabled ? 1 - Math.pow(1 - t, 3) : t)
    });
    lastCameraCenter = center;
    lastFlyTime = now;
    return;
  }

  const movedM = haversineDistance(lastCameraCenter[1], lastCameraCenter[0], center[1], center[0]);
  if (movedM < CAMERA_MIN_MOVE_M && now - lastFlyTime < CAMERA_UPDATE_INTERVAL_MS) {
    return;
  }

  map.easeTo({
    center,
    zoom: cinematicDemoEnabled ? 17.2 : 17,
    duration: cinematicDemoEnabled ? 620 : 450,
    pitch: cinematicDemoEnabled ? 46 : 0,
    bearing: cinematicDemoEnabled ? cinematicBearing : 0,
    easing: (t) => (cinematicDemoEnabled ? 1 - Math.pow(1 - t, 3) : t)
  });
  lastCameraCenter = center;
  lastFlyTime = now;
}

function processStartProximity(latitude, longitude) {
  if (cinematicDemoEnabled && sessionMode === 'planned_route') {
    hasReachedStart = true;
    lastStartStatus = null;
    return;
  }
  if (sessionMode === 'planned_route' && plannedStart && !isTracking) {
    const distToStart = haversineDistance(
      plannedStart[1],
      plannedStart[0],
      latitude,
      longitude
    );

    if (distToStart <= START_RADIUS_M) {
      hasReachedStart = true;
      lastStartStatus = null;
      removeStartMarker();
      clearNavToStartLine();
      statusDiv.innerText = '✅ Вы в зоне старта маршрута, нажмите "Старт"';
    } else {
      hasReachedStart = false;
      const rounded = Math.round(distToStart / 5) * 5;
      const msg = `📍 Подойдите к старту (≈ ${rounded} м)`;
      if (msg !== lastStartStatus) {
        lastStartStatus = msg;
        statusDiv.innerText = msg;
      }
    }
  }
}

function emitSyntheticGpsPoint(latitude, longitude, accuracy = 4) {
  const now = Date.now();
  applyPassiveUserPosition(latitude, longitude, accuracy, now);
  if (!isTracking) return;
  onGPSPosition({
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    },
    timestamp: now
  });
}

function stopCinematicRoutePlayback() {
  if (cinematicPlaybackRafId && typeof window !== 'undefined' && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(cinematicPlaybackRafId);
  }
  cinematicPlaybackRafId = null;
}

function startCinematicRoutePlayback() {
  if (!cinematicDemoEnabled || sessionMode !== 'planned_route') return;
  const baseCoords = getRouteLineCoordinates();
  if (!baseCoords || baseCoords.length < 2) return;
  const coords = buildCinematicPath(baseCoords, 10);
  stopCinematicRoutePlayback();

  const totalDurationMs = 26000;
  const startTs = Date.now();

  const tick = () => {
    if (!isTracking || isPaused) {
      cinematicPlaybackRafId = null;
      return;
    }
    const now = Date.now();
    const progress = Math.min(1, (now - startTs) / totalDurationMs);
    const exactIndex = progress * (coords.length - 1);
    const baseIndex = Math.floor(exactIndex);
    const frac = exactIndex - baseIndex;
    const base = coords[Math.min(baseIndex, coords.length - 1)];
    const next = coords[Math.min(baseIndex + 1, coords.length - 1)];
    const lon = base[0] + (next[0] - base[0]) * frac;
    const lat = base[1] + (next[1] - base[1]) * frac;
    emitSyntheticGpsPoint(lat, lon, 3);

    if (progress >= 1) {
      cinematicPlaybackRafId = null;
      if (isTracking) {
        stopAndSave();
      }
      return;
    }
    cinematicPlaybackRafId = window.requestAnimationFrame(tick);
  };

  // Start exactly at route start for presentation consistency.
  emitSyntheticGpsPoint(coords[0][1], coords[0][0], 3);
  cinematicPlaybackRafId = window.requestAnimationFrame(tick);
}

function applyPassiveUserPosition(latitude, longitude, accuracy, now) {
  lastKnownPosition = { latitude, longitude, accuracy };
  updateGPSQuality(accuracy);
  if (isReplayRunning || isReplayViewLocked) return;
  processStartProximity(latitude, longitude);
  updateNavToStartLineIfNeeded(latitude, longitude);
  updateUserMarker([longitude, latitude]);

  if (!isTracking && isFollowingUser) {
    smoothCameraFollow([longitude, latitude], now);
  }
}

function ensurePassiveLocationWatch() {
  if (!navigator.geolocation || passiveWatchId !== null) return;

  passiveWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      let latitude;
      let longitude;
      let accuracy;
      if (simulateEnabled && simulatedGeo) {
        latitude = simulatedGeo.lat;
        longitude = simulatedGeo.lng;
        accuracy = 5;
      } else {
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
        accuracy = pos.coords.accuracy;
      }
      applyPassiveUserPosition(latitude, longitude, accuracy, now);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 7000 }
  );
}



// === ЗАГРУЗКА СИСТЕМНОГО МАРШРУТА (routes.geojson) ===



async function loadPlannedRoute(id) {

  try {

    statusDiv.innerText = 'Загрузка маршрута...';

    const res  = await fetch(`/api/routes/${id}/geojson`);

    const data = await res.json();

    if (!data.ok) throw new Error(data.error);



    plannedRoute = data.route;



    removeLegacyPlannedRouteLayerIfAny();
    ensurePlannedRouteProgressLayers();

    const coords = getRouteLineCoordinates();
    if (coords.length >= 2) {
      setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, coords);
      setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, []);
    }

    const center = coords.length ? coords[Math.floor(coords.length / 2)] : [42.7165, 43.9071];

    // Старт и финиш — первая и последняя точка линии маршрута (как в GeoJSON)
    plannedStart = coords.length ? coords[0] : null;
    plannedFinish = coords.length >= 2 ? coords[coords.length - 1] : null;
    if (!cinematicDemoEnabled && plannedStart) {
      setStartMarker([plannedStart[0], plannedStart[1]]);
    }
    if (!cinematicDemoEnabled && plannedFinish) {
      setFinishMarker([plannedFinish[0], plannedFinish[1]]);
    }
    if (cinematicDemoEnabled) {
      removeStartMarker();
      removeFinishMarker();
    }

    // Один поток геолокации: не вызывать getUserLocation() здесь — второй getCurrentPosition
    // с другим timeout давал гонку: при timeout 5s срабатывал error и карта улетала в центр линии
    // маршрута, хотя позже приходил успешный фикс с реальной позицией пользователя.
    ensurePassiveLocationWatch();

    navigator.geolocation.getCurrentPosition(

      (pos) => {

        let userLat = pos.coords.latitude;

        let userLng = pos.coords.longitude;

        let accuracy = pos.coords.accuracy;

        if (simulateEnabled && simulatedGeo) {
          userLat = simulatedGeo.lat;
          userLng = simulatedGeo.lng;
          accuracy = 5;
        }

        const now = Date.now();
        applyPassiveUserPosition(userLat, userLng, accuracy, now);

        const distanceToStart =
          plannedStart != null
            ? Math.round(haversineDistance(userLat, userLng, plannedStart[1], plannedStart[0]))
            : 0;

        const userCenter = [userLng, userLat];
        lastCameraCenter = userCenter;
        isFollowingUser = true;
        map.jumpTo({
          center: userCenter,
          zoom: cinematicDemoEnabled ? 17.2 : 17,
          pitch: cinematicDemoEnabled ? 46 : 0,
          bearing: 0
        });

        updateNavToStartLineIfNeeded(userLat, userLng);

        statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен. До «СТАРТ» ≈ ${distanceToStart} м. Оранжевая линия — направление к старту.`;

        setTimeout(() => {

          if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

        }, 4000);

      },

      (err) => {

        console.error('Ошибка получения местоположения:', err);

        const applyFallbackCamera = () => {
          if (lastKnownPosition) {
            const c = [lastKnownPosition.longitude, lastKnownPosition.latitude];
            lastCameraCenter = c;
            isFollowingUser = true;
            map.flyTo({
              center: c,
              zoom: cinematicDemoEnabled ? 17.2 : 17,
              pitch: cinematicDemoEnabled ? 46 : 0,
              duration: cinematicDemoEnabled ? 1300 : 900
            });
            statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен. До «СТАРТ» см. маркер и оранжевую линию.`;
          } else {
            map.flyTo({
              center: [center[0], center[1]],
              zoom: cinematicDemoEnabled ? 15.5 : 15,
              pitch: cinematicDemoEnabled ? 38 : 0,
              duration: cinematicDemoEnabled ? 1200 : 900
            });
            statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен. Подойдите к маркеру «СТАРТ» и нажмите «Старт»`;
          }
          setTimeout(() => {
            if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';
          }, 3000);
        };

        setTimeout(applyFallbackCamera, 1000);

      },

      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }

    );

    if (simulateEnabled) {
      simRouteStepIndex = 0;
      ensureSimulatePanel();
    }

  } catch (err) {

    console.error(err);

    statusDiv.innerText = '❌ Ошибка загрузки маршрута';

  }

}



// === ГЕОЛОКАЦИЯ ===



function getUserLocation() {

  if (!navigator.geolocation) {

    statusDiv.innerText = '❌ Геолокация не поддерживается';

    return;

  }



  statusDiv.innerText = '📍 Запрос местоположения...';



  navigator.geolocation.getCurrentPosition(

    (pos) => {

      const now = Date.now();
      let latitude;
      let longitude;
      let accuracy;
      if (simulateEnabled && simulatedGeo) {
        latitude = simulatedGeo.lat;
        longitude = simulatedGeo.lng;
        accuracy = 5;
      } else {
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
        accuracy = pos.coords.accuracy;
      }
      applyPassiveUserPosition(latitude, longitude, accuracy, now);

      map.flyTo({
        center: [longitude, latitude],
        zoom: cinematicDemoEnabled ? 16.6 : 16,
        pitch: cinematicDemoEnabled ? 42 : 0,
        duration: cinematicDemoEnabled ? 1100 : 900
      });

      statusDiv.innerText = '✅ GPS готов, можно стартовать';

      setTimeout(() => {

        if (statusDiv.innerText === '✅ Готов к тренировке') statusDiv.innerText = '';

      }, 2000);

    },

    (err) => {

      console.error(err);

      statusDiv.innerText = '❌ Нет доступа к геолокации';

    },

    { enableHighAccuracy: true }

  );

  ensurePassiveLocationWatch();

}


// === ПРОГРЕСС ПО МАРШРУТУ ===

function initializeRouteProgress() {
  const coords = getRouteLineCoordinates();
  if (!coords.length) return;

  let totalRouteDistanceM = 0;
  for (let i = 1; i < coords.length; i += 1) {
    totalRouteDistanceM += haversineDistance(
      coords[i - 1][1],
      coords[i - 1][0],
      coords[i][1],
      coords[i][0]
    );
  }

  routeProgress.currentIndex = 0;
  routeProgress.completedSegments = 0;
  routeProgress.totalSegments = coords.length - 1;
  routeProgress.isOnRoute = true;
  routeProgress.lastProgressUpdate = Date.now();
  routeProgress.totalRouteDistanceM = totalRouteDistanceM;
  routeProgress.distanceDoneM = 0;
  routeProgress.distanceRemainingM = totalRouteDistanceM;
  routeProgress.completionPercent = 0;
  routeProgress.offRouteSince = null;
  routeProgress.maxClosestIndex = 0;
  routeProgress.passedCoords = [];

  applyPlannedRouteProgressToMap(0);

  if (routeProgressEl) {
    routeProgressEl.style.display = 'block';
    routeProgressEl.innerText = 'Прогресс: 0% | До финиша: --';
  }
}

function updateRouteProgress(lat, lng) {
  const now = Date.now();
  if (!routeProgress.isOnRoute || now - routeProgress.lastProgressUpdate < PROGRESS_UPDATE_INTERVAL_MS) {
    return;
  }

  const coords = getRouteLineCoordinates();
  if (coords.length < 2) return;

  let closestIndex = 0;
  let minDistanceToVertex = Infinity;
  for (let i = 0; i < coords.length; i += 1) {
    const d = haversineDistance(lat, lng, coords[i][1], coords[i][0]);
    if (d < minDistanceToVertex) {
      minDistanceToVertex = d;
      closestIndex = i;
    }
  }

  const progressIndex = Math.max(routeProgress.maxClosestIndex || 0, closestIndex);
  routeProgress.maxClosestIndex = progressIndex;

  let distanceDoneM = 0;
  for (let i = 1; i <= progressIndex; i += 1) {
    distanceDoneM += haversineDistance(
      coords[i - 1][1],
      coords[i - 1][0],
      coords[i][1],
      coords[i][0]
    );
  }

  const totalRouteDistanceM = routeProgress.totalRouteDistanceM || 1;
  const completionPercent = Math.min(100, Math.round((distanceDoneM / totalRouteDistanceM) * 100));
  const distanceRemainingM = Math.max(0, totalRouteDistanceM - distanceDoneM);

  routeProgress.currentIndex = closestIndex;
  routeProgress.completedSegments = Math.max(0, progressIndex);
  routeProgress.distanceDoneM = distanceDoneM;
  routeProgress.distanceRemainingM = distanceRemainingM;
  routeProgress.completionPercent = completionPercent;
  routeProgress.lastProgressUpdate = now;

  applyPlannedRouteProgressToMap(progressIndex);

  const currentCoord = [lng, lat];
  routeProgress.passedCoords.push(currentCoord);
  if (routeProgress.passedCoords.length > 1200) {
    routeProgress.passedCoords = routeProgress.passedCoords.slice(-1200);
  }
  setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, routeProgress.passedCoords);

  if (routeProgressEl) {
    routeProgressEl.style.display = 'block';
    routeProgressEl.innerText = `Прогресс: ${completionPercent}% | Осталось: ${(distanceRemainingM / 1000).toFixed(2)} км`;
  }
}


// === МАРКЕРЫ ===



function addUserMarker(lngLat) {

  if (userMarker) userMarker.remove();

  const el = document.createElement('div');
  if (cinematicDemoEnabled) el.classList.add('terra-user-marker-core');

  el.style.cssText =
    `width:${cinematicDemoEnabled ? 44 : 40}px;height:${cinematicDemoEnabled ? 44 : 40}px;background:rgba(0,0,0,0.2);border:2px solid rgba(255,255,255,0.85);border-radius:50%;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);`;

  const arrowWrapEl = document.createElement('div');
  arrowWrapEl.style.cssText =
    'width:16px;height:16px;display:flex;align-items:center;justify-content:center;transform:rotate(0deg);transform-origin:center center;';

  const svgNs = 'http://www.w3.org/2000/svg';
  const arrowSvg = document.createElementNS(svgNs, 'svg');
  arrowSvg.setAttribute('viewBox', '0 0 24 24');
  arrowSvg.setAttribute('width', '28');
  arrowSvg.setAttribute('height', '28');
  arrowSvg.style.filter = 'drop-shadow(0 0 5px rgba(0,0,0,0.9))';

  const arrowPath = document.createElementNS(svgNs, 'path');
  arrowPath.setAttribute('d', 'M12 1.5 L22 22 L12 17 L2 22 Z');
  arrowPath.setAttribute('fill', '#22c55e');
  arrowPath.setAttribute('stroke', '#ffffff');
  arrowPath.setAttribute('stroke-width', '2.4');
  arrowSvg.appendChild(arrowPath);
  arrowWrapEl.appendChild(arrowSvg);

  el.appendChild(arrowWrapEl);
  userMarkerEl = arrowWrapEl;

  userMarker = new maplibregl.Marker(el)
    .setLngLat(lngLat)
    .setRotation(0)
    .setRotationAlignment('map')
    .setPitchAlignment('map')
    .addTo(map);

}



function updateUserMarker(lngLat, headingDeg = null) {
  if (isReplayRunning || isReplayViewLocked) return;

  if (userMarker) userMarker.setLngLat(lngLat);

  else addUserMarker(lngLat);

  if (typeof headingDeg === 'number' && userMarkerEl) {
    lastHeadingDeg = headingDeg;
    userMarkerEl.style.transform = `rotate(${headingDeg}deg)`;
    if (userMarker) userMarker.setRotation(headingDeg);
    return;
  }

  if (typeof lastHeadingDeg === 'number' && userMarkerEl) {
    userMarkerEl.style.transform = `rotate(${lastHeadingDeg}deg)`;
  }

}



function setStartMarker(lngLat) {

  if (startMarker) {

    startMarker.setLngLat(lngLat);

    return;

  }

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));';

  const badge = document.createElement('div');
  badge.style.cssText =
    'min-width:38px;height:38px;border-radius:50%;background:linear-gradient(145deg,#4ade80,#15803d);border:3px solid #fff;box-shadow:0 0 0 2px rgba(21,128,61,0.9);display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;';
  badge.innerHTML = '&#x1F6A9;';
  badge.title = 'Старт';

  const lbl = document.createElement('div');
  lbl.textContent = 'СТАРТ';
  lbl.style.cssText =
    'margin-top:3px;font-size:10px;font-weight:800;letter-spacing:0.12em;color:#fff;background:rgba(21,128,61,0.96);padding:2px 7px;border-radius:8px;border:1px solid rgba(255,255,255,0.9);';

  wrap.appendChild(badge);
  wrap.appendChild(lbl);

  startMarker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
    .setLngLat(lngLat)
    .addTo(map);

}

function removeStartMarker() {
  if (startMarker) {
    startMarker.remove();
    startMarker = null;
  }
}

function setFinishMarker(lngLat) {
  if (finishMarker) {
    finishMarker.setLngLat(lngLat);
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.55));';

  const badge = document.createElement('div');
  badge.style.cssText =
    'min-width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#7c3aed 0%,#4c1d95 55%,#1e1b4b 100%);border:3px solid #fbbf24;box-shadow:inset 0 0 0 2px rgba(251,191,36,0.35);display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;';
  badge.innerHTML = '&#x1F3C1;';
  badge.title = 'Финиш';

  const lbl = document.createElement('div');
  lbl.textContent = 'ФИНИШ';
  lbl.style.cssText =
    'margin-top:3px;font-size:10px;font-weight:800;letter-spacing:0.14em;color:#fef3c7;background:rgba(76,29,149,0.98);padding:2px 7px;border-radius:8px;border:1px solid #fbbf24;';

  wrap.appendChild(badge);
  wrap.appendChild(lbl);

  finishMarker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
    .setLngLat(lngLat)
    .addTo(map);
}

function removeFinishMarker() {
  if (finishMarker) {
    finishMarker.remove();
    finishMarker = null;
  }
}

// === МАТЕМАТИКА ДИСТАНЦИИ ===



function haversineDistance(lat1, lon1, lat2, lon2) {

  const R    = 6371000;

  const toRad = x => x * Math.PI / 180;

  const φ1   = toRad(lat1);

  const φ2   = toRad(lat2);

  const Δφ   = toRad(lat2 - lat1);

  const Δλ   = toRad(lon2 - lon1);

  const a =

    Math.sin(Δφ / 2) ** 2 +

    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

}

function destinationPointLatLon(latDeg, lonDeg, bearingDeg, distanceM) {
  const R = 6371000;
  const δ = distanceM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (latDeg * Math.PI) / 180;
  const λ1 = (lonDeg * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

function interpolateCatmullRom2D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (
      (2 * p1[0]) +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
    ),
    0.5 * (
      (2 * p1[1]) +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
    )
  ];
}

function buildCinematicPath(rawCoords, subdivisions = 10) {
  if (!Array.isArray(rawCoords) || rawCoords.length < 2) return rawCoords || [];
  const points = [];
  for (let i = 0; i < rawCoords.length - 1; i += 1) {
    const p0 = i === 0 ? rawCoords[i] : rawCoords[i - 1];
    const p1 = rawCoords[i];
    const p2 = rawCoords[i + 1];
    const p3 = i + 2 < rawCoords.length ? rawCoords[i + 2] : rawCoords[i + 1];
    for (let j = 0; j < subdivisions; j += 1) {
      const t = j / subdivisions;
      points.push(interpolateCatmullRom2D(p0, p1, p2, p3, t));
    }
  }
  points.push(rawCoords[rawCoords.length - 1]);
  return points;
}

function calculateBearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const toDeg = (v) => (v * 180) / Math.PI;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  const heading = toDeg(Math.atan2(y, x));
  return (heading + 360) % 360;
}

function pointAwayFromStart(coords, distanceM) {
  const lon0 = coords[0][0];
  const lat0 = coords[0][1];
  if (coords.length < 2) {
    return destinationPointLatLon(lat0, lon0, 180, distanceM);
  }
  const lon1 = coords[1][0];
  const lat1 = coords[1][1];
  const bearing = calculateBearingDeg(lat0, lon0, lat1, lon1);
  const back = (bearing + 180) % 360;
  return destinationPointLatLon(lat0, lon0, back, distanceM);
}

function pointOffRouteAtStep(coords, stepIndex, distanceM = 16) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const idx = Math.min(Math.max(0, stepIndex), coords.length - 2);
  const base = coords[idx];
  const next = coords[idx + 1];
  const bearing = calculateBearingDeg(base[1], base[0], next[1], next[0]);
  const sideBearing = (bearing + 90) % 360;
  return destinationPointLatLon(base[1], base[0], sideBearing, distanceM);
}

function runSimFinishScenario() {
  const coords = getRouteLineCoordinates();
  if (!coords.length || !plannedStart || !plannedFinish) return;

  simRouteStepIndex = 0;
  setSimulatedPosition(plannedStart[1], plannedStart[0]);

  setTimeout(() => {
    if (!isTracking) startRun();
  }, 250);

  setTimeout(() => {
    if (coords.length > 3) {
      const midIdx = Math.floor(coords.length / 2);
      simRouteStepIndex = midIdx;
      setSimulatedPosition(coords[midIdx][1], coords[midIdx][0]);
    }
  }, 900);

  setTimeout(() => {
    const endIdx = Math.max(0, coords.length - 1);
    simRouteStepIndex = endIdx;
    setSimulatedPosition(plannedFinish[1], plannedFinish[0]);
  }, 1550);
}

function runSimOffRouteScenario() {
  const coords = getRouteLineCoordinates();
  if (!coords.length || !plannedStart) return;

  setSimulatedPosition(plannedStart[1], plannedStart[0]);
  setTimeout(() => {
    if (!isTracking) startRun();
  }, 220);

  setTimeout(() => {
    const safeStep = Math.min(Math.max(1, simRouteStepIndex || 1), Math.max(1, coords.length - 2));
    const offPoint = pointOffRouteAtStep(coords, safeStep, 18);
    if (offPoint) {
      simRouteStepIndex = safeStep;
      setSimulatedPosition(offPoint.lat, offPoint.lon);
    }
  }, 900);
}

function setSimulatedPosition(lat, lng) {
  if (!simulateEnabled) return;
  simulatedGeo = { lat, lng };
  const now = Date.now();
  applyPassiveUserPosition(lat, lng, 5, now);
  if (isTracking) {
    onGPSPosition({
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: now
    });
  }
}

function ensureSimulatePanel() {
  if (!simulateEnabled || !routeId || document.getElementById('terraSimPanel')) return;
  ensureUiEnhancements();
  const panel = document.createElement('div');
  panel.id = 'terraSimPanel';
  panel.style.cssText =
    'position:fixed;top:108px;right:10px;z-index:10;max-width:min(210px,calc(100vw - 24px));background:rgba(15,23,42,0.94);color:#e2e8f0;border:1px solid rgba(248,250,252,0.22);border-radius:14px;padding:10px 10px 6px;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,0.4);';

  const title = document.createElement('div');
  title.textContent = 'Тест без прогулки';
  title.style.cssText = 'font-weight:700;margin-bottom:6px;color:#fff;font-size:12px;';
  panel.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'Параметр URL: simulate=1';
  hint.style.cssText = 'opacity:0.8;margin-bottom:8px;line-height:1.35;font-size:10px;';
  panel.appendChild(hint);

  function addBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'display:block;width:100%;margin-bottom:6px;padding:8px 10px;font-size:12px;font-weight:600;border:none;border-radius:10px;background:#334155;color:#fff;cursor:pointer;';
    b.onclick = onClick;
    panel.appendChild(b);
  }

  addBtn('~80 м от старта', () => {
    const coords = getRouteLineCoordinates();
    if (coords.length < 1) return;
    const p = pointAwayFromStart(coords, 80);
    simRouteStepIndex = 0;
    setSimulatedPosition(p.lat, p.lon);
  });
  addBtn('В зоне старта', () => {
    if (!plannedStart) return;
    simRouteStepIndex = 0;
    setSimulatedPosition(plannedStart[1], plannedStart[0]);
  });
  addBtn('+1 вершина трека', () => {
    const coords = getRouteLineCoordinates();
    if (!coords.length) return;
    if (typeof TerraSimHelpers !== 'undefined' && TerraSimHelpers.nextRouteStepIndex) {
      simRouteStepIndex = TerraSimHelpers.nextRouteStepIndex(simRouteStepIndex, coords.length, 1);
    } else {
      simRouteStepIndex = Math.min(simRouteStepIndex + 1, coords.length - 1);
    }
    const c = coords[simRouteStepIndex];
    setSimulatedPosition(c[1], c[0]);
  });
  addBtn('Сброс к старту', () => {
    const coords = getRouteLineCoordinates();
    if (!coords.length) return;
    simRouteStepIndex = 0;
    const c = coords[0];
    setSimulatedPosition(c[1], c[0]);
  });
  addBtn('У финиша', () => {
    if (!plannedFinish) return;
    const coords = getRouteLineCoordinates();
    simRouteStepIndex = Math.max(0, coords.length - 1);
    setSimulatedPosition(plannedFinish[1], plannedFinish[0]);
  });
  addBtn('Тест отклонения (жёлтый)', () => {
    runSimOffRouteScenario();
  });
  addBtn('Авто-финиш (итог + replay)', () => {
    runSimFinishScenario();
  });

  document.body.appendChild(panel);
}



// === ADAPTIVE FILTERING ===



function updateCurrentSpeed(newSpeed) {
  recentSpeeds.push(newSpeed);

  if (recentSpeeds.length > SPEED_HISTORY_SIZE) {

    recentSpeeds.shift();

  }

}



function getAverageSpeed() {

  if (recentSpeeds.length === 0) return 0;

  return recentSpeeds.reduce((sum, speed) => sum + speed, 0) / recentSpeeds.length;

}



function getAdaptiveFilters() {

  const avgSpeed = getAverageSpeed();

  const isLowSpeed = avgSpeed < LOW_SPEED_THRESHOLD_M_S;

  

  return {

    maxAccuracy: isLowSpeed ? 20 : BASE_MAX_ACCURACY_METERS,  // stricter in low-speed mode

    maxJump: isLowSpeed ? 30 : BASE_MAX_JUMP_METERS,           // smaller jumps in low-speed mode

    minDistance: isLowSpeed ? 2 : BASE_MIN_DISTANCE_METERS,

    maxSpeed: isLowSpeed ? 4 : BASE_MAX_SPEED_M_S,             // lower max in low-speed mode

    minTime: isLowSpeed ? 1000 : 800

  };

}

function scheduleTrackRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  const draw = () => {
    redrawQueued = false;
    redrawTrack();
  };
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(draw);
    return;
  }
  setTimeout(draw, 16);
}



function detectMovementPattern() {

  if (recentSpeeds.length < 3) return 'unknown';

  

  const speeds = recentSpeeds.slice(-3);

  const variance = speeds.reduce((sum, speed) => {

    const avg = getAverageSpeed();

    return sum + Math.pow(speed - avg, 2);

  }, 0) / speeds.length;

  

  if (variance < 0.5) return 'steady';      // stable speed

  if (variance > 2.0) return 'erratic';     // lots of speed changes

  return 'normal';                          // normal variation

}



// === ЛОГИКА ФИЛЬТРАЦИИ GPS ===



function shouldSavePoint(lat, lng, now, accuracy) {

  // Get adaptive filters based on current movement pattern

  const filters = getAdaptiveFilters();

  const pattern = detectMovementPattern();

  

  // Dynamic accuracy threshold

  if (typeof accuracy === 'number' && accuracy > filters.maxAccuracy) {

    console.warn(`Point rejected by accuracy = ${accuracy.toFixed(1)} m (threshold: ${filters.maxAccuracy} m, pattern: ${pattern})`);

    return false;

  }



  if (!lastSavedPoint) return true;



  const dist     = haversineDistance(lastSavedPoint.lat, lastSavedPoint.lng, lat, lng);

  const timeDiff = now - lastSavedPoint.timestamp;



  // Update speed tracking

  if (timeDiff > 0) {

    const speed = dist / (timeDiff / 1000);

    updateCurrentSpeed(speed);

    

    // Dynamic speed threshold

    if (speed > filters.maxSpeed && dist > filters.minDistance) {

      console.warn(`Speed outlier: ${speed.toFixed(1)} m/s (max: ${filters.maxSpeed} m/s, dist=${dist.toFixed(1)} m, dt=${timeDiff} ms, acc=${accuracy}, pattern: ${pattern})`);

      return false;

    }

  }



  // Dynamic jump detection

  if (dist > filters.maxJump && timeDiff < filters.minTime) {

    console.warn(`GPS jump: ${dist.toFixed(1)} m in ${timeDiff} ms (max: ${filters.maxJump} m, min time: ${filters.minTime} ms, acc=${accuracy}, pattern: ${pattern})`);

    return false;

  }



  // Dynamic distance/time thresholds

  const shouldSave = dist >= filters.minDistance || timeDiff >= filters.minTime;

  

  if (!shouldSave) {

    console.log(`Point too close/fast: dist=${dist.toFixed(1)} m (min: ${filters.minDistance} m), dt=${timeDiff} ms (min: ${filters.minTime} ms), pattern: ${pattern}`);

  }



  return shouldSave;

}

function resetTrailDisplayHead() {
  trailDisplayLat = null;
  trailDisplayLng = null;
}

function snapTrailDisplayTo(lat, lng) {
  trailDisplayLat = lat;
  trailDisplayLng = lng;
}

function updateTrailDisplayHead(rawLat, rawLng) {
  if (trailDisplayLat === null || trailDisplayLng === null) {
    trailDisplayLat = rawLat;
    trailDisplayLng = rawLng;
    return;
  }
  const lag = haversineDistance(trailDisplayLat, trailDisplayLng, rawLat, rawLng);
  if (lag > TRAIL_DISPLAY_MAX_LAG_M) {
    trailDisplayLat = rawLat;
    trailDisplayLng = rawLng;
    return;
  }
  const a = TRAIL_DISPLAY_SMOOTH_ALPHA;
  trailDisplayLat = a * rawLat + (1 - a) * trailDisplayLat;
  trailDisplayLng = a * rawLng + (1 - a) * trailDisplayLng;
}



function addFilteredPoint(lat, lng, timestamp, accuracy) {

  // Для готового маршрута – не пишем трек, пока не достигнут старт

  if (sessionMode === 'planned_route' && plannedRoute && !hasReachedStart) {

    return false;

  }



  if (!shouldSavePoint(lat, lng, timestamp, accuracy)) return false;



  const point = { lat, lng, timestamp, accuracy };



  if (trackPoints.length > 0) {

    const prev = trackPoints[trackPoints.length - 1];

    const segment = haversineDistance(prev.lat, prev.lng, lat, lng);

    totalDistanceM += segment;

  }



  trackPoints.push(point);

  lastSavedPoint = point;

  return true;

}



// === ОБНОВЛЕНИЕ UI ===



function updateStatsUI() {

  if (!startTime || !isTracking) return;



  const now = Date.now();

  let elapsedSec = (now - startTime - pausedDuration) / 1000;

  if (elapsedSec < 0) elapsedSec = 0;



  const minutes = Math.floor(elapsedSec / 60);

  const seconds = Math.floor(elapsedSec % 60);

  timeEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;



  const distanceKm = totalDistanceM / 1000;

  distanceEl.textContent = distanceKm.toFixed(2);

  if (estCaloriesEl) {
    estCaloriesEl.textContent = formatCaloriesKcalShort(
      estimateWorkoutCaloriesKcal(totalDistanceM, elapsedSec)
    );
  }



}



function redrawTrack() {

  if (!map || !map.getSource('run-track')) return;

  // Для готового маршрута трек прогресса рисуется зелёной/синей линиями.
  // Красную линию скрываем, чтобы не дублировать и не путать.
  if (sessionMode === 'planned_route') {
    map.getSource('run-track').setData({
      type: 'FeatureCollection',
      features: []
    });
    return;
  }



  const coordinates = trackPoints.map(p => [p.lng, p.lat]);

  if (
    isTracking &&
    trailDisplayLat != null &&
    trailDisplayLng != null &&
    trackPoints.length > 0
  ) {
    const last = coordinates[coordinates.length - 1];
    const dHead = haversineDistance(last[1], last[0], trailDisplayLat, trailDisplayLng);
    if (dHead >= 0.65) {
      coordinates.push([trailDisplayLng, trailDisplayLat]);
    }
  }



  map.getSource('run-track').setData({

    type: 'FeatureCollection',

    features: [

      {

        type: 'Feature',

        geometry: {

          type: 'LineString',

          coordinates

        },

        properties: {}

      }

    ]

  });

}

function ensureReplayLayer() {
  if (!map) return;
  if (!map.getSource(REPLAY_SOURCE_ID)) {
    map.addSource(REPLAY_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer(REPLAY_LAYER_ID)) {
    map.addLayer({
      id: REPLAY_LAYER_ID,
      type: 'line',
      source: REPLAY_SOURCE_ID,
      paint: {
        'line-color': '#22c55e',
        'line-width': cinematicDemoEnabled ? 8 : 6,
        'line-opacity': cinematicDemoEnabled ? 0.98 : 0.95,
        'line-blur': cinematicDemoEnabled ? 0.3 : 0
      }
    });
  }
}

function setReplayCoordinates(coords) {
  if (!map?.getSource(REPLAY_SOURCE_ID)) return;
  map.getSource(REPLAY_SOURCE_ID).setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {}
      }
    ]
  });
}

function setReplayMapStatic(enabled) {
  if (!map) return;
  const method = enabled ? 'disable' : 'enable';
  map.dragPan?.[method]?.();
  map.scrollZoom?.[method]?.();
  map.boxZoom?.[method]?.();
  map.dragRotate?.[method]?.();
  map.keyboard?.[method]?.();
  map.doubleClickZoom?.[method]?.();
  map.touchZoomRotate?.[method]?.();
}

function hideLiveMarkerForReplay() {
  if (userMarker) {
    userMarker.remove();
    userMarker = null;
    userMarkerEl = null;
  }
}

function animateCompletedPath(trackCoords, options = {}) {
  const { onProgress, onDone } = options;
  if (!Array.isArray(trackCoords) || trackCoords.length < 2 || !map) return;
  if (replayTimerId) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(replayTimerId);
    }
    replayTimerId = null;
  }
  isReplayRunning = true;
  isReplayViewLocked = true;
  setReplayMapStatic(true);

  // Hide live red track so replay animation is clearly visible.
  if (map.getSource('run-track')) {
    map.getSource('run-track').setData({
      type: 'FeatureCollection',
      features: []
    });
  }

  ensureReplayLayer();
  hideLiveMarkerForReplay();

  const totalPoints = trackCoords.length;
  const totalDurationMs = REPLAY_DURATION_MS;
  const startTs = Date.now();

  setReplayCoordinates([trackCoords[0]]);
  const rawBounds = trackCoords.reduce(
    (acc, c) => {
      acc[0][0] = Math.min(acc[0][0], c[0]);
      acc[0][1] = Math.min(acc[0][1], c[1]);
      acc[1][0] = Math.max(acc[1][0], c[0]);
      acc[1][1] = Math.max(acc[1][1], c[1]);
      return acc;
    },
    [[trackCoords[0][0], trackCoords[0][1]], [trackCoords[0][0], trackCoords[0][1]]]
  );

  // Keep room for summary panel, but avoid excessive zoom-out.
  const replayBottomPadding = Math.max(12, Math.round(window.innerHeight * 0.01));
  map.fitBounds(rawBounds, {
    padding: { top: 8, right: 6, bottom: replayBottomPadding, left: 6 },
    duration: 820,
    maxZoom: 17
  });

  const tick = () => {
    const nowTs = Date.now();
    const progress = Math.min(1, (nowTs - startTs) / totalDurationMs);
    const exactIndex = progress * (totalPoints - 1);
    const baseIndex = Math.floor(exactIndex);
    const frac = exactIndex - baseIndex;
    const base = trackCoords[Math.min(baseIndex, totalPoints - 1)];
    const next = trackCoords[Math.min(baseIndex + 1, totalPoints - 1)];
    const interpolated = [
      base[0] + (next[0] - base[0]) * frac,
      base[1] + (next[1] - base[1]) * frac
    ];
    const replayCoords = trackCoords.slice(0, Math.max(1, baseIndex + 1));
    replayCoords.push(interpolated);
    setReplayCoordinates(replayCoords);
    if (map && interpolated) {
      if (cinematicDemoEnabled) {
        map.easeTo({
          center: interpolated,
          duration: 120,
          pitch: 44,
          bearing: typeof lastHeadingDeg === 'number' ? lastHeadingDeg : map.getBearing(),
          easing: (t) => t
        });
      } else {
        map.jumpTo({ center: interpolated });
      }
    }
    if (typeof onProgress === 'function') onProgress(Math.round(progress * 100));

    if (progress >= 1) {
      replayTimerId = null;
      setReplayCoordinates(trackCoords);
      isReplayRunning = false;
      isReplayViewLocked = false;
      setReplayMapStatic(false);
      if (typeof onDone === 'function') onDone();
      return;
    }
    replayTimerId = window.requestAnimationFrame(tick);
  };
  replayTimerId = window.requestAnimationFrame(tick);
}

function showWorkoutSummaryAndReplay({ distanceM, elapsedSec, trackCoords, showReplay = true, isSaved = false }) {
  if (!replayPanelEl) return;
  const km = (distanceM / 1000).toFixed(2);
  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
  const speedKmh = elapsedSec > 0 ? (distanceM / 1000) / (elapsedSec / 3600) : 0;
  const avgSpeed = Number.isFinite(speedKmh) && speedKmh > 0 ? `${speedKmh.toFixed(1).replace('.', ',')} км/ч` : '—';
  const kcal = formatCaloriesKcalShort(estimateWorkoutCaloriesKcal(distanceM, elapsedSec));
  const kcalSub = 'при весе 70 кг';
  const saveBadge = isSaved
    ? `<div style="background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:#d9ffe8;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:600;margin-bottom:8px;">✅ Маршрут сохранен в истории</div>`
    : '';
  const summaryCard =
    saveBadge +
    `<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Итог тренировки</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Км</div><div style="font-size:20px;font-weight:700;">${km}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Мин : Сек</div><div style="font-size:20px;font-weight:700;">${mins}:${secs}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Скорость</div><div style="font-size:18px;font-weight:700;">${avgSpeed}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Ккал (оценка)</div><div style="font-size:18px;font-weight:700;">${kcal}</div><div style="font-size:10px;opacity:0.6;margin-top:2px;">${kcalSub}</div></div>` +
    `</div>`;

  if (showReplay && Array.isArray(trackCoords) && trackCoords.length >= 2) {
    replayPanelEl.innerHTML =
      summaryCard +
      `<div id="replayPhase" style="font-size:11px;opacity:0.75;margin-top:6px;">Подготовка воспроизведения...</div>`;
    replayPanelEl.style.display = 'block';
    const phaseEl = replayPanelEl.querySelector('#replayPhase');
    animateCompletedPath(trackCoords, {
      onProgress: (percent) => {
        if (phaseEl) phaseEl.textContent = `Воспроизведение ${percent}%`;
      },
      onDone: () => {
        if (phaseEl) phaseEl.remove();
        removeStartMarker();
        removeFinishMarker();
      }
    });
    return;
  }

  replayPanelEl.innerHTML =
    summaryCard +
    `<div style="font-size:11px;opacity:0.75;margin-top:8px;">Пройденная тропа на карте отмечена зелёным.</div>`;
  replayPanelEl.style.display = 'block';
}



// Сглаживание позиции по последним N точкам

function getSmoothedPosition() {

  if (trackPoints.length === 0) return null;



  const len   = trackPoints.length;

  const count = Math.min(3, len);

  let sumLat  = 0;

  let sumLng  = 0;



  for (let i = len - count; i < len; i++) {

    sumLat += trackPoints[i].lat;

    sumLng += trackPoints[i].lng;

  }



  return { lat: sumLat / count, lng: sumLng / count };

}



// === ОБРАБОТЧИК GPS ===



function onGPSPosition(pos) {
  if (!isTracking) return;
  isFollowingUser = true;



  let latitude;
  let longitude;
  let accuracy;
  if (simulateEnabled && simulatedGeo) {
    latitude = simulatedGeo.lat;
    longitude = simulatedGeo.lng;
    accuracy = 5;
  } else {
    latitude = pos.coords.latitude;
    longitude = pos.coords.longitude;
    accuracy = pos.coords.accuracy;
  }
  lastKnownPosition = { latitude, longitude, accuracy };
  updateGPSQuality(accuracy);

  const now = Date.now();
  let headingDeg = null;
  if (lastRawPoint) {
    const headingDistanceM = haversineDistance(lastRawPoint.lat, lastRawPoint.lng, latitude, longitude);
    if (headingDistanceM >= 2) {
      headingDeg = calculateBearingDeg(lastRawPoint.lat, lastRawPoint.lng, latitude, longitude);
    }
  }

  // Check finish point for planned routes
  if (sessionMode === 'planned_route' && plannedFinish && !hasReachedFinish) {
    const distToFinish = haversineDistance(
      plannedFinish[1], plannedFinish[0],
      latitude, longitude
    );

    if (distToFinish <= FINISH_RADIUS_M) {
      hasReachedFinish = true;
      finalizePlannedRouteMapProgress();
      routeProgress.isOnRoute = false;
      removeFinishMarker();
      statusDiv.innerText = '🏁 Финиш! Маршрут завершён!';
      setTimeout(() => {
        if (statusDiv.innerText.includes('Финиш')) {
          statusDiv.innerText = '';
        }
      }, 3000);
      
      // Auto stop training when finish reached
      setTimeout(() => {
        stopAndSave();
      }, 1000);
    }
  }

  lastRawPoint = { lat: latitude, lng: longitude, timestamp: now };

  if (isPaused && !autoPausedBySystem) return;
  if (isPaused && autoPausedBySystem) {
    updateUserMarker([longitude, latitude], headingDeg);
    return;
  }



  const savedPoint = addFilteredPoint(latitude, longitude, now, accuracy);

  if (savedPoint) {
    snapTrailDisplayTo(latitude, longitude);
  } else {
    updateTrailDisplayHead(latitude, longitude);
  }

  scheduleTrackRedraw();

  const center =
    trailDisplayLat != null && trailDisplayLng != null
      ? [trailDisplayLng, trailDisplayLat]
      : (() => {
          const smoothed = getSmoothedPosition();
          return smoothed ? [smoothed.lng, smoothed.lat] : [longitude, latitude];
        })();



  updateUserMarker(center, headingDeg);



  // Отслеживание прогресса по маршруту

  if (sessionMode === 'planned_route' && hasReachedStart) {

    updateRouteProgress(latitude, longitude);

  }



  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {

    const distToStart = haversineDistance(

      plannedStart[1], plannedStart[0],

      center[1], center[0]

    );



    if (distToStart <= START_RADIUS_M) {

      hasReachedStart = true;

      lastStartStatus = null;
      removeStartMarker();
      clearNavToStartLine();

      initializeRouteProgress(); // инициализируем отслеживание прогресса

      statusDiv.innerText = '✅ Вы в зоне старта маршрута, можно начинать';

      setTimeout(() => {

        if (statusDiv.innerText.includes('зоне старта')) {

          statusDiv.innerText = '';

        }

      }, 3000);

    } else {

      const rounded = Math.round(distToStart / 5) * 5;

      const msg = `📍 Подойдите к старту (≈ ${rounded} м)`;

      if (msg !== lastStartStatus) {

        lastStartStatus = msg;

        statusDiv.innerText = msg;

      }

    }

  }



  smoothCameraFollow(center, now);

}



// === СТАРТ / ПАУЗА / СТОП ===



function startRun() {

  // если уже трекается и не на паузе — игнорируем

  if (isTracking && !isPaused) return;



  const needsRealGps = !(cinematicDemoEnabled && sessionMode === 'planned_route');
  if (needsRealGps && !navigator.geolocation) {

    statusDiv.innerText = '❌ Геолокация недоступна';

    syncStopButtonVisibility();
    return;

  }

  // Для готового маршрута: требуем дойти до старта

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
    if (cinematicDemoEnabled) {
      hasReachedStart = true;
      removeStartMarker();
      clearNavToStartLine();
    }
    if (lastKnownPosition) {
      processStartProximity(
        lastKnownPosition.latitude,
        lastKnownPosition.longitude
      );
    }
    if (hasReachedStart) {
      // fall through and start tracking
    } else {
      statusDiv.innerText = '🏁 Сначала подойдите к стартовому флажку на карте';
      syncStopButtonVisibility();
      return;
    }
  }

  if (passiveWatchId !== null) {
    navigator.geolocation.clearWatch(passiveWatchId);
    passiveWatchId = null;
  }



  if (!isTracking) {

    // Первый запуск тренировки

    isTracking     = true;
    isFollowingUser = true;
    lastCameraCenter = null;
    setPostRunUiMode(false);
    isReplayViewLocked = false;
    setReplayMapStatic(false);
    hasReachedFinish = false; // Сбрасываем состояние финиша

    isPaused       = false;

    trackPoints    = [];

    totalDistanceM = 0;

    lastSavedPoint = null;
    lastRawPoint = null;
    autoPausedBySystem = false;
    resetTrailDisplayHead();
    clearNavToStartLine();
    if (replayPanelEl) replayPanelEl.style.display = 'none';
    if (map?.getSource(REPLAY_SOURCE_ID)) {
      setReplayCoordinates([]);
    }



    startTime      = Date.now();

    pausedDuration = 0;

    pauseStart     = null;



    statsPanel.classList.remove('hidden');

    startBtn.textContent = '⏸ Пауза';



    statusDiv.innerText = '🏃 Тренировка началась...';



    redrawTrack();

    if (sessionMode === 'planned_route' && plannedRoute) {
      initializeRouteProgress();
    }



    if (!cinematicDemoEnabled || sessionMode !== 'planned_route') {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        onGPSPosition,
        (err) => console.error(err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    } else {
      startCinematicRoutePlayback();
    }



    if (uiTimerId === null) {

      uiTimerId = setInterval(() => {

        if (isTracking && !isPaused) updateStatsUI();

      }, 1000);

    }

  } else if (isTracking && isPaused) {

    // Возврат из паузы

    isPaused = false;

    if (pauseStart) {

      pausedDuration += Date.now() - pauseStart;

      pauseStart = null;

    }

    startBtn.textContent = '⏸ Пауза';

    statusDiv.innerText  = '▶️ Продолжаем...';

    setTimeout(() => {

      if (statusDiv.innerText === '▶️ Продолжаем...') statusDiv.innerText = '';

    }, 1500);



    if (watchId === null && (!cinematicDemoEnabled || sessionMode !== 'planned_route')) {

      watchId = navigator.geolocation.watchPosition(

        onGPSPosition,

        (err) => console.error(err),

        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }

      );

    }

  }

  syncStopButtonVisibility();

}



function pauseResume() {

  if (!isTracking) return;



  if (isPaused) {

    // снятие с паузы делаем через startRun, чтобы логика не дублировалась

    startRun();

  } else {

    // ставим на паузу

    isPaused   = true;
    autoPausedBySystem = false;

    pauseStart = Date.now();

    startBtn.textContent = '▶️ Старт';

    statusDiv.innerText  = '⏸ Тренировка на паузе';



    if (watchId !== null) {

      navigator.geolocation.clearWatch(watchId);

      watchId = null;

    }
    if (cinematicDemoEnabled && sessionMode === 'planned_route') {
      stopCinematicRoutePlayback();
    }

    syncStopButtonVisibility();

  }

}



async function stopAndSave() {

  if (!isTracking) return;



  if (watchId !== null) {

    navigator.geolocation.clearWatch(watchId);

    watchId = null;

  }
  stopCinematicRoutePlayback();



  isTracking = false;

  isPaused   = false;
  autoPausedBySystem = false;



  const endTime  = Date.now();

  let elapsedSec = (endTime - startTime - pausedDuration) / 1000;

  if (elapsedSec < 0) elapsedSec = 0;



  const distanceM       = totalDistanceM;

  const avgPaceSecPerKm =

    distanceM > 0 ? elapsedSec / (distanceM / 1000) : 0;



  // Если вообще нет точек — не сохраняем сессию, просто сбрасываем UI

  if (!trackPoints.length || distanceM === 0) {

    statsPanel.classList.add('hidden');

    startBtn.textContent = '▶️ Старт';

    statusDiv.innerText = '⚠️ Недостаточно данных для сохранения тренировки';

    setTimeout(() => {

      if (statusDiv.innerText.includes('Недостаточно данных')) {

        statusDiv.innerText = '';

      }

    }, 3000);

    syncStopButtonVisibility();

    if (uiTimerId !== null) {

      clearInterval(uiTimerId);

      uiTimerId = null;

    }

    return;

  }



  const geojsonTrack = {

    type: 'FeatureCollection',

    features: [

      {

        type: 'Feature',

        geometry: {

          type: 'LineString',

          coordinates: trackPoints.map(p => [p.lng, p.lat])

        },

        properties: {

          startTime,

          endTime

        }

      }

    ]

  };



  const session = {

    startedAt: new Date(startTime).toISOString(),

    finishedAt: new Date(endTime).toISOString(),

    durationSec: elapsedSec,

    distanceM,

    avgPaceSecPerKm,

    estCaloriesKcal: Math.round(estimateWorkoutCaloriesKcal(distanceM, elapsedSec)),

    geojson: geojsonTrack,

    mode: sessionMode,

    activityId: activityIdFromUrl || null

  };



  if (sessionMode === 'planned_route') {

    if (routeId) {

      // системный маршрут

      if (plannedRoute && plannedRoute.properties && plannedRoute.properties.id) {

        session.plannedRouteId = plannedRoute.properties.id;

      } else {

        session.plannedRouteId = routeId;

      }

    }

  }



  let saveSucceeded = false;
  try {
    statusDiv.innerText = 'Сохранение...';

    const res  = await fetch('/api/sessions', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },

      body: JSON.stringify({ chatId, authToken, session })

    });

    const data = await res.json();

    statusDiv.innerText = data.ok ? '' : '⚠️ Ошибка сохранения';
    saveSucceeded = Boolean(data.ok);

  } catch (err) {

    console.error(err);

    statusDiv.innerText = '❌ Не удалось сохранить';

  }



  statsPanel.classList.add('hidden');

  startBtn.textContent   = '▶️ Старт';



  setTimeout(() => {

    if (!statusDiv.innerText.includes('Тренировка сохранена')) {

      statusDiv.innerText = '';

    }

  }, 3000);

  syncStopButtonVisibility();

  if (uiTimerId !== null) {

    clearInterval(uiTimerId);

    uiTimerId = null;

  }

  if (routeProgressEl) {
    routeProgressEl.style.display = 'none';
  }
  setPostRunUiMode(true);

  const replayCoordinates = trackPoints.map((p) => [p.lng, p.lat]);
  await new Promise((resolve) => setTimeout(resolve, saveSucceeded ? 1200 : 300));
  if (!saveSucceeded) {
    statusDiv.innerText = 'Подготовка воспроизведения...';
  }
  showWorkoutSummaryAndReplay({
    distanceM,
    elapsedSec,
    trackCoords: replayCoordinates,
    showReplay: true,
    isSaved: saveSucceeded
  });

  ensurePassiveLocationWatch();

}



// === КНОПКИ ===



function startTrackingFlow() {
  startRun();
}

startBtn.onclick = () => (isTracking ? pauseResume() : startTrackingFlow());

if (stopBtnEl) {
  stopBtnEl.addEventListener('click', () => stopAndSave());
}

// routesBtn.onclick  = () => { statusDiv.innerText = 'Выберите маршрут в боте'; };

// historyBtn.onclick = () => { statusDiv.innerText = 'История тренировок (скоро)'; };



// Старт приложения

ensureCinematicStyles();
ensureUiEnhancements();
syncStopButtonVisibility();
initMap();