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
const customRouteMode = urlParams.get('customRoute') === '1' || urlParams.get('mode') === 'custom';
const replayDebugEnabled = urlParams.get('replayDebug') === '1';

const chatId      = urlParams.get('chatId') || 'test_user';
const authToken   = urlParams.get('authToken') || '';
const activityIdFromUrl = urlParams.get('activityId');
let userWeightKg = 70;
let userAge = null;
const mapProvider = (urlParams.get('mapProvider') || '').toLowerCase();
const dgisKeyFromUrl = (urlParams.get('dgisKey') || '').trim();
const miniAppRuntime = window.__MINI_APP_RUNTIME__ || {};
const dgisApiKeyFromRuntime = typeof miniAppRuntime.DGIS_API_KEY === 'string'
  ? miniAppRuntime.DGIS_API_KEY.trim()
  : '';
let dgisApiKey = dgisApiKeyFromRuntime || dgisKeyFromUrl;
const dgisDisabledByUrl = mapProvider === 'maplibre' || mapProvider === 'osm';
const dgisExplicitByUrl = mapProvider === '2gis';
const dgisDefaultEnabled = !dgisDisabledByUrl;
const dgisRequested = dgisExplicitByUrl || dgisDefaultEnabled;
let dgisRasterEnabled = dgisRequested && Boolean(dgisApiKey);
let isNativeMapGl = false;

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

} else if (customRouteMode) {

  sessionMode = 'planned_route';

} else {

  sessionMode = 'free_run';

}

let customRouteBuilderEl = null;
let customSearchInputEl = null;
let customWaypoints = [];

function isCustomPlannedRoute() {
  return sessionMode === 'planned_route' && plannedRoute?.properties?.id === 'custom-user-route';
}

async function ensureDgisApiKeyLoaded() {
  if (!dgisRequested || dgisApiKey) return;
  const tryExtractFromRuntimeScript = (text) => {
    if (!text || text.includes('<!DOCTYPE') || text.includes('<html')) return '';
    const match = text.match(/window\.__MINI_APP_RUNTIME__\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return '';
    try {
      const parsed = JSON.parse(match[1]);
      const apiKey = typeof parsed?.DGIS_API_KEY === 'string' ? parsed.DGIS_API_KEY.trim() : '';
      return apiKey;
    } catch (_err) {
      return '';
    }
  };
  try {
    const res = await fetch('/api/runtime-config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const apiKey = typeof data?.DGIS_API_KEY === 'string' ? data.DGIS_API_KEY.trim() : '';
      if (apiKey) {
        dgisApiKey = apiKey;
        dgisRasterEnabled = true;
        return;
      }
    }
  } catch (_err) {
    // Continue with fallback source below.
  }
  try {
    const runtimeRes = await fetch(`/mini-app/runtime-config.js?v=${Date.now()}`, { cache: 'no-store' });
    if (!runtimeRes.ok) return;
    const runtimeText = await runtimeRes.text();
    const runtimeKey = tryExtractFromRuntimeScript(runtimeText);
    if (!runtimeKey) return;
    dgisApiKey = runtimeKey;
    dgisRasterEnabled = true;
  } catch (_err) {
    // Keep silent fallback: map continues with standard tiles if API key is unavailable.
  }
}

function getAuthHeaders() {
  if (!authToken) return {};
  return { 'x-miniapp-auth': authToken };
}

function estimateCaloriesForUser(distanceM, durationSec) {
  const base = estimateWorkoutCaloriesKcal(distanceM, durationSec, userWeightKg);
  const age = Number(userAge);
  if (!Number.isFinite(age) || age <= 0) return base;
  const ageFactor = Math.max(0.9, Math.min(1.1, 1 + (age - 30) * 0.002));
  return base * ageFactor;
}

async function loadUserProfileForCalories() {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const res = await fetch(`/api/profile?${query.toString()}`, { headers: getAuthHeaders() });
  if (!res.ok) return;
  const data = await res.json();
  if (!data?.ok) return;
  const profile = data.profile || {};
  const weight = Number(profile.weightKg);
  userWeightKg = Number.isFinite(weight) && weight > 0 ? weight : 70;
  const age = Number(profile.age);
  userAge = Number.isFinite(age) && age > 0 ? age : null;
}

function mapEventToLngLat(evt) {
  if (!evt) return null;
  if (evt.lngLat && Number.isFinite(evt.lngLat.lng) && Number.isFinite(evt.lngLat.lat)) {
    return { lon: evt.lngLat.lng, lat: evt.lngLat.lat };
  }
  if (Array.isArray(evt.lngLat) && evt.lngLat.length >= 2) {
    return { lon: Number(evt.lngLat[0]), lat: Number(evt.lngLat[1]) };
  }
  if (evt.point && Number.isFinite(evt.point.lon) && Number.isFinite(evt.point.lat)) {
    return { lon: evt.point.lon, lat: evt.point.lat };
  }
  if (evt.detail && Number.isFinite(evt.detail.lon) && Number.isFinite(evt.detail.lat)) {
    return { lon: evt.detail.lon, lat: evt.detail.lat };
  }
  return null;
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
const mapglCompat = {
  sources: {},
  layers: {}
};

function debugReplay(stage, extra = '') {
  if (!replayDebugEnabled) return;
  const msg = `[replay] ${stage}${extra ? ` | ${extra}` : ''}`;
  console.log(msg);
  if (statusDiv) statusDiv.innerText = msg;
}

async function saveRouteToHistory({ routeName, activityId, routeId, sourceSessionId }) {
  const res = await fetch('/api/history/save-route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      chatId,
      authToken,
      routeName,
      activityId,
      routeId,
      sourceSessionId
    })
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Не удалось сохранить маршрут');
  }
}

function renderSaveRouteFlow(meta) {
  if (!replayPanelEl || !meta || !meta.isSessionSaved) return;
  const flowHost = replayPanelEl.querySelector('#saveRouteFlowHost');
  if (!flowHost) return;

  flowHost.innerHTML = `
    <button type="button" id="saveRouteBtn" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(82,183,136,0.65);background:rgba(31,122,70,0.24);color:#e6fff0;font-size:14px;font-weight:700;cursor:pointer;">
      Сохранить маршрут
    </button>
  `;

  const saveRouteBtn = flowHost.querySelector('#saveRouteBtn');
  saveRouteBtn?.addEventListener('click', () => {
    flowHost.innerHTML = `
      <div style="margin-top:10px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Название маршрута</div>
        <input id="routeNameInput" type="text" value="${(meta.defaultRouteName || '').replace(/"/g, '&quot;')}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.24);background:rgba(255,255,255,0.06);color:#fff;" />
        <div id="routeNameWarn" style="display:none;color:#ff9f9f;font-size:12px;margin-top:6px;">Введите называние!</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
          <button type="button" id="saveRouteConfirm" style="padding:9px;border-radius:8px;border:1px solid rgba(82,183,136,0.65);background:rgba(31,122,70,0.24);color:#e6fff0;cursor:pointer;">Подтвердить</button>
          <button type="button" id="saveRouteCancel" style="padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">Отменить</button>
        </div>
      </div>
    `;

    const inputEl = flowHost.querySelector('#routeNameInput');
    const warnEl = flowHost.querySelector('#routeNameWarn');
    const cancelEl = flowHost.querySelector('#saveRouteCancel');
    const confirmEl = flowHost.querySelector('#saveRouteConfirm');

    cancelEl?.addEventListener('click', () => renderSaveRouteFlow(meta));
    confirmEl?.addEventListener('click', () => {
      const routeName = String(inputEl?.value || '').trim();
      if (!routeName) {
        if (warnEl) warnEl.style.display = 'block';
        return;
      }
      if (warnEl) warnEl.style.display = 'none';
      flowHost.innerHTML = `
        <div style="font-size:13px;font-weight:600;margin-top:10px;margin-bottom:8px;">Выберите активность</div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;">
          <button type="button" data-act="running" style="padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">🏃 Бег</button>
          <button type="button" data-act="nordic_walking" style="padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">🥾 Скандинавская ходьба</button>
          <button type="button" data-act="cycling" style="padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">🚲 Велопрогулки</button>
        </div>
        <button type="button" id="saveRouteBack" style="margin-top:8px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;">Отменить</button>
        <div id="saveRouteResult" style="font-size:12px;margin-top:8px;color:#dbeafe;"></div>
      `;

      flowHost.querySelector('#saveRouteBack')?.addEventListener('click', () => renderSaveRouteFlow(meta));
      const resultEl = flowHost.querySelector('#saveRouteResult');
      const activityButtons = Array.from(flowHost.querySelectorAll('[data-act]'));
      activityButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
          const activityId = btn.getAttribute('data-act');
          activityButtons.forEach((b) => {
            b.disabled = true;
          });
          try {
            await saveRouteToHistory({
              routeName,
              activityId,
              routeId: meta.routeId,
              sourceSessionId: meta.sessionId
            });
            flowHost.innerHTML = `
              <div style="margin-top:10px;background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:#d9ffe8;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:600;">
                ✅ Маршрут сохранен в историю
              </div>
            `;
          } catch (err) {
            if (resultEl) resultEl.textContent = err.message || 'Ошибка сохранения';
            activityButtons.forEach((b) => {
              b.disabled = false;
            });
          }
        });
      });
    });
  });
}

function normalizeLayerPaint(paint = {}) {
  return {
    color: paint['line-color'] || '#3b82f6',
    width: Number(paint['line-width']) || 4,
    opacity: typeof paint['line-opacity'] === 'number' ? paint['line-opacity'] : 1
  };
}

function geoJsonLineCoordinates(data) {
  const feature = data?.features?.[0];
  const coords = feature?.geometry?.type === 'LineString' ? feature.geometry.coordinates : [];
  return Array.isArray(coords) ? coords : [];
}

function destroyMapEntity(entity) {
  if (!entity) return;
  if (typeof entity.remove === 'function') entity.remove();
  else if (typeof entity.destroy === 'function') entity.destroy();
}

function renderMapglSource(sourceId) {
  const sourceState = mapglCompat.sources[sourceId];
  if (!sourceState) return;
  const coords = geoJsonLineCoordinates(sourceState.data);
  const style = sourceState.paint || { color: '#3b82f6', width: 4, opacity: 1 };

  if (!coords.length) {
    destroyMapEntity(sourceState.polyline);
    sourceState.polyline = null;
    return;
  }

  if (sourceState.polyline && typeof sourceState.polyline.setCoordinates === 'function') {
    sourceState.polyline.setCoordinates(coords);
    return;
  }
  if (sourceState.polyline && typeof sourceState.polyline.setOptions === 'function') {
    sourceState.polyline.setOptions({ ...style, coordinates: coords });
    return;
  }

  destroyMapEntity(sourceState.polyline);
  sourceState.polyline = new mapgl.Polyline(map, {
    coordinates: coords,
    color: style.color,
    width: style.width,
    opacity: style.opacity
  });
}

function installMapglCompat() {
  map.addSource = (sourceId, _def) => {
    if (!mapglCompat.sources[sourceId]) {
      mapglCompat.sources[sourceId] = {
        data: { type: 'FeatureCollection', features: [] },
        paint: null,
        polyline: null
      };
    }
  };
  map.getSource = (sourceId) => {
    const src = mapglCompat.sources[sourceId];
    if (!src) return null;
    return {
      setData(data) {
        src.data = data;
        renderMapglSource(sourceId);
      }
    };
  };
  map.addLayer = (layerDef) => {
    mapglCompat.layers[layerDef.id] = layerDef;
    const sourceId = layerDef.source;
    if (!sourceId) return;
    if (!mapglCompat.sources[sourceId]) {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    mapglCompat.sources[sourceId].paint = normalizeLayerPaint(layerDef.paint);
    renderMapglSource(sourceId);
  };
  map.getLayer = (layerId) => mapglCompat.layers[layerId] || null;
  map.removeLayer = (layerId) => {
    delete mapglCompat.layers[layerId];
  };
  map.removeSource = (sourceId) => {
    const src = mapglCompat.sources[sourceId];
    if (!src) return;
    destroyMapEntity(src.polyline);
    delete mapglCompat.sources[sourceId];
  };
  map.easeTo = ({ center, zoom, pitch, bearing, duration }) => {
    if (center) map.setCenter(center, { duration: duration || 0 });
    if (typeof zoom === 'number' && typeof map.setZoom === 'function') map.setZoom(zoom, { duration: duration || 0 });
    if (typeof pitch === 'number' && typeof map.setPitch === 'function') map.setPitch(pitch, { duration: duration || 0 });
    if (typeof bearing === 'number') {
      if (typeof map.setRotation === 'function') map.setRotation(bearing, { duration: duration || 0 });
      else if (typeof map.setBearing === 'function') map.setBearing(bearing, { duration: duration || 0 });
    }
  };
  map.jumpTo = ({ center, zoom, pitch, bearing }) => {
    if (center) map.setCenter(center, { duration: 0 });
    if (typeof zoom === 'number' && typeof map.setZoom === 'function') map.setZoom(zoom, { duration: 0 });
    if (typeof pitch === 'number' && typeof map.setPitch === 'function') map.setPitch(pitch, { duration: 0 });
    if (typeof bearing === 'number') {
      if (typeof map.setRotation === 'function') map.setRotation(bearing, { duration: 0 });
      else if (typeof map.setBearing === 'function') map.setBearing(bearing, { duration: 0 });
    }
  };
  map.flyTo = ({ center, zoom, pitch, bearing, duration }) => {
    map.easeTo({ center, zoom, pitch, bearing, duration: duration || 0 });
  };
  map.fitBounds = (bounds, opts = {}) => {
    const ne = bounds?.[1];
    const sw = bounds?.[0];
    if (!ne || !sw || typeof map.fitBounds !== 'function') return;
    mapgl.Map.prototype.fitBounds.call(map, { northEast: ne, southWest: sw }, { padding: opts.padding || 40 });
  };
  map.dragPan = { enable() {}, disable() {} };
  map.scrollZoom = { enable() {}, disable() {} };
  map.boxZoom = { enable() {}, disable() {} };
  map.dragRotate = { enable() {}, disable() {} };
  map.keyboard = { enable() {}, disable() {} };
  map.doubleClickZoom = { enable() {}, disable() {} };
  map.touchZoomRotate = { enable() {}, disable() {} };
}



// Для статуса по старту

let lastStartStatus = null;   // последнее текстовое состояние про "подойдите к старту"



// === ИНИЦИАЛИЗАЦИЯ КАРТЫ ===



function initMap() {
  isNativeMapGl =
    dgisRequested &&
    Boolean(dgisApiKey) &&
    typeof mapgl !== 'undefined';

  if (customRouteMode && !isNativeMapGl) {
    statusDiv.innerText = '❌ Конструктор собственного маршрута работает только на 2GIS (проверьте dgisKey/DGIS_API_KEY)';
    return;
  }
  const rasterTiles = dgisRasterEnabled
    ? [
        `https://tile0.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`,
        `https://tile1.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`,
        `https://tile2.maps.2gis.com/v2/tiles/online_hd/{z}/{x}/{y}.png?key=${encodeURIComponent(dgisApiKey)}`
      ]
    : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
  if (isNativeMapGl) {
    map = new mapgl.Map('map', {
      key: dgisApiKey,
      center: [42.7165, 43.9071],
      zoom: 13,
      pitch: cinematicDemoEnabled ? 42 : 0
    });
    installMapglCompat();
  } else {
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
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [42.7165, 43.9071],
      zoom: 13,
      pitch: cinematicDemoEnabled ? 42 : 0,
      bearing: 0
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
  }
  if (typeof map.on === 'function') {
    map.on('dragstart', () => {
      isFollowingUser = false;
    });
  }



  const onMapReady = () => {
    if (dgisRequested && !dgisRasterEnabled) {
      statusDiv.innerText = '2GIS карта для маршрута не включена: ключ не найден (DGIS_API_KEY/dgisKey). Используется стандартная карта.';
    } else if (isNativeMapGl) {
      statusDiv.innerText = 'Native 2GIS MapGL включен';
    } else if (dgisRasterEnabled) {
      statusDiv.innerText = '2GIS карта маршрута включена';
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

        'line-color': '#28c1ff',

        'line-width': cinematicDemoEnabled ? 10 : 7,
        'line-opacity': cinematicDemoEnabled ? 0.96 : 0.9

      }

    });
    if (cinematicDemoEnabled) {
      map.addLayer({
        id: 'run-line-glow',
        type: 'line',
        source: 'run-track',
        paint: {
          'line-color': '#23c6ff',
          'line-width': 18,
          'line-opacity': 0.24,
          'line-blur': 0.9
        }
      }, 'run-line');
    }

    ensureNavToStartLayer();



    if (routeId) {

      // системный маршрут из routes.geojson

      loadPlannedRoute(routeId);

    } else if (customRouteMode) {
      ensureCustomRouteBuilderUi();
      getUserLocation();
      if (typeof map.on === 'function') {
        map.on('click', (evt) => {
          const p = mapEventToLngLat(evt);
          if (!p) return;
          customWaypoints.push([p.lon, p.lat]);
          renderCustomRouteDraft();
          statusDiv.innerText = `Точка добавлена (${customWaypoints.length})`;
        });
      }

    } else {

      // свободный трек

      getUserLocation();

    }

  };
  if (isNativeMapGl && typeof map.once === 'function') {
    map.once('idle', onMapReady);
  } else {
    map.on('load', onMapReady);
  }

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

function applyPlannedRouteFeature(routeFeature) {
  plannedRoute = routeFeature;
  removeLegacyPlannedRouteLayerIfAny();
  ensurePlannedRouteProgressLayers();

  const coords = getRouteLineCoordinates();
  if (coords.length >= 2) {
    setGeoJSONLineSource(PLANNED_ROUTE_REMAINING_SOURCE, coords);
    setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, []);
  }

  plannedStart = coords.length ? coords[0] : null;
  plannedFinish = coords.length >= 2 ? coords[coords.length - 1] : null;
  hasReachedStart = false;
  hasReachedFinish = false;
  routeProgress.isOnRoute = false;
  routeProgress.passedCoords = [];

  removeStartMarker();
  removeFinishMarker();
  if (!cinematicDemoEnabled && plannedStart) setStartMarker([plannedStart[0], plannedStart[1]]);
  if (!cinematicDemoEnabled && plannedFinish) setFinishMarker([plannedFinish[0], plannedFinish[1]]);
  if (cinematicDemoEnabled) clearNavToStartLine();

  const center = coords.length ? coords[Math.floor(coords.length / 2)] : [42.7165, 43.9071];
  if (map && typeof map.easeTo === 'function') {
    map.easeTo({
      center,
      zoom: cinematicDemoEnabled ? 15.5 : 15,
      pitch: cinematicDemoEnabled ? 38 : 0,
      duration: cinematicDemoEnabled ? 950 : 700
    });
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
      'line-color': '#26d6ff',
      'line-width': 7,
      'line-opacity': 0.92
    }
  });

  map.addLayer({
    id: 'planned-route-remaining-line',
    type: 'line',
    source: PLANNED_ROUTE_REMAINING_SOURCE,
    paint: {
      'line-color': '#9fb1c4',
      'line-width': 4,
      'line-dasharray': [2, 2],
      'line-opacity': 0.95
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
      'line-color': '#ff9b35',
      'line-width': 5,
      'line-dasharray': [0.6, 1.1],
      'line-opacity': 0.96
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
  if (isCustomPlannedRoute()) {
    hasReachedStart = true;
    lastStartStatus = null;
    clearNavToStartLine();
    return;
  }
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
    const res  = await fetch(`/api/routes/${id}/geojson`, {
      cache: 'no-store'
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    let data = null;
    let usedLocalFallback = false;
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(rawText);
      } catch (_err) {
        data = null;
      }
    }
    if (!res.ok || !data || !data.ok) {
      // Fallback when /api proxy returns HTML or malformed payload.
      const localRes = await fetch('./routes.geojson?v=20260422-1', { cache: 'no-store' });
      if (!localRes.ok) {
        if (!data) throw new Error(`Сервер вернул не JSON (content-type: ${contentType || 'unknown'})`);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const localFc = await localRes.json();
      const feature = (localFc.features || []).find((f) => f?.properties?.id === id);
      if (!feature) {
        throw new Error('Маршрут не найден ни через API, ни в routes.geojson');
      }
      data = { ok: true, route: feature };
      usedLocalFallback = true;
    }


    applyPlannedRouteFeature(data.route);
    const coords = getRouteLineCoordinates();

    const center = coords.length ? coords[Math.floor(coords.length / 2)] : [42.7165, 43.9071];

    // Старт и финиш уже синхронизированы в applyPlannedRouteFeature.

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

        statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен${usedLocalFallback ? ' (fallback)' : ''}. До «СТАРТ» ≈ ${distanceToStart} м. Оранжевая линия — направление к старту.`;

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
    const msg = (err && typeof err.message === 'string') ? err.message : 'unknown error';
    statusDiv.innerText = `❌ Ошибка загрузки маршрута: ${msg}`;

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

  if (userMarker) destroyMapEntity(userMarker);

  if (isNativeMapGl) {
    userMarker = new mapgl.Marker(map, {
      coordinates: lngLat,
      icon: makeMapglIcon('user'),
      zIndex: 7000
    });
    userMarkerEl = null;
    return;
  }

  const el = document.createElement('div');
  if (cinematicDemoEnabled) el.classList.add('terra-user-marker-core');

  el.style.cssText =
    `width:${cinematicDemoEnabled ? 44 : 40}px;height:${cinematicDemoEnabled ? 44 : 40}px;background:rgba(17,34,55,0.32);border:2px solid rgba(103,208,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);`;

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
  arrowPath.setAttribute('fill', '#22d3ee');
  arrowPath.setAttribute('stroke', '#e0f2fe');
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

  if (userMarker) {
    if (isNativeMapGl && typeof userMarker.setCoordinates === 'function') userMarker.setCoordinates(lngLat);
    else userMarker.setLngLat(lngLat);
  }

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
    if (isNativeMapGl && typeof startMarker.setCoordinates === 'function') startMarker.setCoordinates(lngLat);
    else startMarker.setLngLat(lngLat);
    return;
  }

  if (isNativeMapGl) {
    startMarker = new mapgl.Marker(map, {
      coordinates: lngLat,
      icon: makeMapglIcon('start'),
      zIndex: 7100
    });
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 3px 12px rgba(0,0,0,0.5));';

  const badge = document.createElement('div');
  badge.style.cssText =
    'min-width:40px;height:40px;border-radius:50%;background:linear-gradient(145deg,#2fd4ff,#2d7bff);border:2px solid rgba(255,255,255,0.92);box-shadow:0 0 0 2px rgba(45,123,255,0.52);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;font-weight:700;color:#fff;';
  badge.innerHTML = 'S';
  badge.title = 'Старт';

  const lbl = document.createElement('div');
  lbl.textContent = 'СТАРТ';
  lbl.style.cssText =
    'margin-top:4px;font-size:10px;font-weight:800;letter-spacing:0.12em;color:#d8f3ff;background:rgba(22,43,70,0.96);padding:2px 7px;border-radius:8px;border:1px solid rgba(103,208,255,0.7);';

  wrap.appendChild(badge);
  wrap.appendChild(lbl);

  startMarker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
    .setLngLat(lngLat)
    .addTo(map);

}

function removeStartMarker() {
  if (startMarker) {
    destroyMapEntity(startMarker);
    startMarker = null;
  }
}

function setFinishMarker(lngLat) {
  if (finishMarker) {
    if (isNativeMapGl && typeof finishMarker.setCoordinates === 'function') finishMarker.setCoordinates(lngLat);
    else finishMarker.setLngLat(lngLat);
    return;
  }

  if (isNativeMapGl) {
    finishMarker = new mapgl.Marker(map, {
      coordinates: lngLat,
      icon: makeMapglIcon('finish'),
      zIndex: 7100
    });
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 3px 12px rgba(0,0,0,0.55));';

  const badge = document.createElement('div');
  badge.style.cssText =
    'min-width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#0f172a 0%,#133359 55%,#214b7e 100%);border:2px solid #67d0ff;box-shadow:inset 0 0 0 2px rgba(103,208,255,0.26);display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;font-weight:800;color:#e8f7ff;';
  badge.innerHTML = 'F';
  badge.title = 'Финиш';

  const lbl = document.createElement('div');
  lbl.textContent = 'ФИНИШ';
  lbl.style.cssText =
    'margin-top:4px;font-size:10px;font-weight:800;letter-spacing:0.14em;color:#d8f3ff;background:rgba(17,36,58,0.98);padding:2px 7px;border-radius:8px;border:1px solid rgba(103,208,255,0.72);';

  wrap.appendChild(badge);
  wrap.appendChild(lbl);

  finishMarker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
    .setLngLat(lngLat)
    .addTo(map);
}

function removeFinishMarker() {
  if (finishMarker) {
    destroyMapEntity(finishMarker);
    finishMarker = null;
  }
}

function makeMapglIcon(type) {
  let fill = '#22d3ee';
  let text = '●';
  if (type === 'start') {
    fill = '#2b95ff';
    text = 'S';
  } else if (type === 'finish') {
    fill = '#0f3a67';
    text = 'F';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="21" fill="${fill}" stroke="rgba(255,255,255,0.92)" stroke-width="3"/>
    <text x="28" y="34" text-anchor="middle" font-size="18" font-weight="700" fill="#ffffff">${text}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
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

function renderCustomRouteDraft() {
  ensurePlannedRouteProgressLayers();
  setGeoJSONLineSource(PLANNED_ROUTE_DONE_SOURCE, []);
  setGeoJSONLineSource(
    PLANNED_ROUTE_REMAINING_SOURCE,
    customWaypoints.length >= 2 ? customWaypoints : []
  );
  removeStartMarker();
  removeFinishMarker();
  if (customWaypoints[0]) setStartMarker(customWaypoints[0]);
  if (customWaypoints.length >= 2) setFinishMarker(customWaypoints[customWaypoints.length - 1]);
}

async function searchAndAddCustomWaypoint() {
  const q = (customSearchInputEl?.value || '').trim();
  if (!q) {
    statusDiv.innerText = 'Введите адрес/место для поиска';
    return;
  }
  statusDiv.innerText = 'Поиск точки через 2GIS...';
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
      headers: getAuthHeaders()
    });
    const data = await r.json();
    const first = data?.items?.[0];
    if (!r.ok || !first) {
      statusDiv.innerText = 'Точка не найдена';
      return;
    }
    const point = [Number(first.lon), Number(first.lat)];
    customWaypoints.push(point);
    renderCustomRouteDraft();
    map.easeTo({ center: point, zoom: 16, duration: 650 });
    statusDiv.innerText = `Добавлено: ${first.title || q}`;
  } catch (err) {
    statusDiv.innerText = `Ошибка поиска: ${err.message}`;
  }
}

async function buildCustomRouteFromWaypoints() {
  if (customWaypoints.length < 2) {
    statusDiv.innerText = 'Добавьте минимум 2 точки маршрута';
    return;
  }
  statusDiv.innerText = 'Сборка пользовательского маршрута...';
  try {
    const r = await fetch('/api/routes/build-custom', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        provider: '2gis',
        waypoints: customWaypoints.map((p) => ({ lon: p[0], lat: p[1] }))
      })
    });
    const data = await r.json();
    if (!r.ok || !data?.ok) {
      statusDiv.innerText = data?.error || 'Не удалось собрать маршрут';
      return;
    }
    const feature = data?.geojson?.features?.[0];
    if (!feature?.geometry?.coordinates?.length) {
      statusDiv.innerText = 'Маршрут пустой';
      return;
    }
    feature.properties = {
      ...(feature.properties || {}),
      id: 'custom-user-route',
      name: 'Собственный маршрут'
    };
    applyPlannedRouteFeature(feature);
    // Custom user route should start tracking immediately from current position.
    hasReachedStart = true;
    clearNavToStartLine();
    removeStartMarker();
    statusDiv.innerText = '✅ Пользовательский маршрут готов. Можно сразу нажимать "Старт".';
    if (customRouteBuilderEl) {
      customRouteBuilderEl.style.display = 'none';
    }
  } catch (err) {
    statusDiv.innerText = `Ошибка сборки: ${err.message}`;
  }
}

function ensureCustomRouteBuilderUi() {
  if (!customRouteMode || customRouteBuilderEl) return;
  customRouteBuilderEl = document.createElement('div');
  customRouteBuilderEl.style.cssText =
    'position:fixed;top:112px;left:14px;right:14px;z-index:6;background:rgba(8,14,22,0.84);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.18);border-radius:14px;padding:10px 10px 8px;';
  customRouteBuilderEl.innerHTML = `
    <div style="font-size:12px;color:#d9eefc;margin-bottom:8px;">Конструктор маршрута 2GIS: кликните по карте или найдите адрес</div>
    <div style="display:flex;gap:6px;">
      <input id="customRouteSearch" type="text" placeholder="Адрес или место" style="flex:1;border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.07);color:#fff;padding:8px 10px;font-size:12px;outline:none;" />
      <button id="customRouteSearchBtn" type="button" style="padding:8px 10px;font-size:12px;">Поиск</button>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button id="customRouteBuildBtn" type="button" style="flex:1;padding:8px 10px;font-size:12px;">Собрать маршрут</button>
      <button id="customRouteUndoBtn" type="button" style="padding:8px 10px;font-size:12px;">Отменить точку</button>
      <button id="customRouteResetBtn" type="button" style="padding:8px 10px;font-size:12px;">Сброс</button>
    </div>
  `;
  document.body.appendChild(customRouteBuilderEl);
  customSearchInputEl = document.getElementById('customRouteSearch');
  document.getElementById('customRouteSearchBtn')?.addEventListener('click', searchAndAddCustomWaypoint);
  document.getElementById('customRouteBuildBtn')?.addEventListener('click', buildCustomRouteFromWaypoints);
  document.getElementById('customRouteUndoBtn')?.addEventListener('click', () => {
    customWaypoints.pop();
    renderCustomRouteDraft();
  });
  document.getElementById('customRouteResetBtn')?.addEventListener('click', () => {
    customWaypoints = [];
    renderCustomRouteDraft();
  });
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

  if (sessionMode === 'planned_route' && plannedRoute && !hasReachedStart && !isCustomPlannedRoute()) {

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
      estimateCaloriesForUser(totalDistanceM, elapsedSec)
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
    destroyMapEntity(userMarker);
    userMarker = null;
    userMarkerEl = null;
  }
}

function animateCompletedPath(trackCoords, options = {}) {
  const { onProgress, onDone } = options;
  debugReplay('animate:start', `points=${Array.isArray(trackCoords) ? trackCoords.length : 0}`);
  if (!Array.isArray(trackCoords) || trackCoords.length < 2 || !map) {
    debugReplay('animate:skip', 'insufficient points or map missing');
    isReplayRunning = false;
    isReplayViewLocked = false;
    setReplayMapStatic(false);
    if (typeof onDone === 'function') onDone();
    return;
  }
  if (replayTimerId) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(replayTimerId);
    }
    clearTimeout(replayTimerId);
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
  try {
    const replayBottomPadding = Math.max(12, Math.round(window.innerHeight * 0.01));
    debugReplay('animate:fitBounds');
    map.fitBounds(rawBounds, {
      padding: { top: 8, right: 6, bottom: replayBottomPadding, left: 6 },
      duration: 820,
      maxZoom: 17
    });
  } catch (_err) {
    debugReplay('animate:fitBounds_failed');
    // fitBounds can fail in some WebView/MapGL states; replay should still continue.
  }

  const scheduleNext = (fn) => setTimeout(fn, 16);
  const tick = () => {
    try {
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
        // Replay camera must be deterministic in WebView; avoid queueing many ease animations.
        map.jumpTo({
          center: interpolated,
          pitch: cinematicDemoEnabled ? 44 : 0,
          bearing: cinematicDemoEnabled
            ? (typeof lastHeadingDeg === 'number' ? lastHeadingDeg : (typeof map.getBearing === 'function' ? map.getBearing() : 0))
            : 0
        });
      }
      if (typeof onProgress === 'function') onProgress(Math.round(progress * 100));
      if (progress === 0) debugReplay('animate:first_tick');

      if (progress >= 1) {
        debugReplay('animate:done');
        replayTimerId = null;
        setReplayCoordinates(trackCoords);
        isReplayRunning = false;
        isReplayViewLocked = false;
        setReplayMapStatic(false);
        if (typeof onDone === 'function') onDone();
        return;
      }
      replayTimerId = scheduleNext(tick);
    } catch (err) {
      debugReplay('animate:error', err.message || 'unknown');
      replayTimerId = null;
      isReplayRunning = false;
      isReplayViewLocked = false;
      setReplayMapStatic(false);
      if (typeof onDone === 'function') onDone(err);
    }
  };
  replayTimerId = scheduleNext(tick);
}

function showWorkoutSummaryAndReplay({ distanceM, elapsedSec, trackCoords, showReplay = true, isSaved = false, saveMeta = null }) {
  if (!replayPanelEl) return;
  const km = (distanceM / 1000).toFixed(2);
  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
  const speedKmh = elapsedSec > 0 ? (distanceM / 1000) / (elapsedSec / 3600) : 0;
  const avgSpeed = Number.isFinite(speedKmh) && speedKmh > 0 ? `${speedKmh.toFixed(1).replace('.', ',')} км/ч` : '—';
  const kcal = formatCaloriesKcalShort(estimateCaloriesForUser(distanceM, elapsedSec));
  const kcalSub = 'при весе 70 кг';
  const saveBadge = isSaved
    ? `<div style="background:rgba(34,197,94,0.16);border:1px solid rgba(34,197,94,0.45);color:#d9ffe8;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:600;margin-bottom:8px;">✅ Тренировка сохранена</div>`
    : '';
  const summaryCard =
    saveBadge +
    `<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Итог тренировки</div>` +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Км</div><div style="font-size:20px;font-weight:700;">${km}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Мин : Сек</div><div style="font-size:20px;font-weight:700;">${mins}:${secs}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Скорость</div><div style="font-size:18px;font-weight:700;">${avgSpeed}</div></div>` +
    `<div style="background:rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;"><div style="font-size:11px;opacity:0.75;">Ккал (оценка)</div><div style="font-size:18px;font-weight:700;">${kcal}</div><div style="font-size:10px;opacity:0.6;margin-top:2px;">${kcalSub}</div></div>` +
    `</div>` +
    `<div id="saveRouteFlowHost"></div>`;

  if (showReplay && Array.isArray(trackCoords) && trackCoords.length >= 2) {
    debugReplay('ui:prepare_replay', `saved=${isSaved}`);
    replayPanelEl.innerHTML =
      summaryCard +
      `<div id="replayPhase" style="font-size:11px;opacity:0.75;margin-top:6px;">Подготовка воспроизведения...</div>`;
    replayPanelEl.style.display = 'block';
    const phaseEl = replayPanelEl.querySelector('#replayPhase');
    const replayWatchdogId = setTimeout(() => {
      if (phaseEl && /Подготовка/.test(phaseEl.textContent || '')) {
        phaseEl.textContent = 'Запуск воспроизведения занял слишком долго. Показан итог тренировки.';
      }
    }, 2500);
    try {
      animateCompletedPath(trackCoords, {
        onProgress: (percent) => {
          clearTimeout(replayWatchdogId);
          if (phaseEl) phaseEl.textContent = `Воспроизведение ${percent}%`;
        },
        onDone: (err) => {
          clearTimeout(replayWatchdogId);
          debugReplay('ui:replay_onDone', err ? String(err.message || err) : 'ok');
          if (phaseEl) {
            if (err) phaseEl.textContent = 'Воспроизведение недоступно, показан итог тренировки.';
            else phaseEl.remove();
          }
          removeStartMarker();
          removeFinishMarker();
        }
      });
    } catch (_err) {
      clearTimeout(replayWatchdogId);
      debugReplay('ui:replay_start_failed', _err.message || 'unknown');
      if (phaseEl) {
        phaseEl.textContent = 'Не удалось запустить воспроизведение, показан итог тренировки.';
      }
    }
    renderSaveRouteFlow(saveMeta);
    return;
  }

  replayPanelEl.innerHTML =
    summaryCard +
    `<div style="font-size:11px;opacity:0.75;margin-top:8px;">Пройденная тропа на карте отмечена зелёным.</div>`;
  replayPanelEl.style.display = 'block';
  renderSaveRouteFlow(saveMeta);
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



  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart && !isCustomPlannedRoute()) {

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

  if (sessionMode === 'planned_route' && !plannedRoute) {
    statusDiv.innerText = '⏳ Маршрут еще загружается. Подождите пару секунд.';
    syncStopButtonVisibility();
    return;
  }

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart && !isCustomPlannedRoute()) {
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



  const generatedSessionId = `sess_${Date.now()}`;
  const session = {
    sessionId: generatedSessionId,

    startedAt: new Date(startTime).toISOString(),

    finishedAt: new Date(endTime).toISOString(),

    durationSec: elapsedSec,

    distanceM,

    avgPaceSecPerKm,

    estCaloriesKcal: Math.round(estimateCaloriesForUser(distanceM, elapsedSec)),

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
    debugReplay('save:start', `points=${trackPoints.length}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('save-timeout'), 9000);
    const res  = await fetch('/api/sessions', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },

      body: JSON.stringify({ chatId, authToken, session }),
      signal: controller.signal

    });
    clearTimeout(timeoutId);

    const data = await res.json();

    statusDiv.innerText = data.ok ? '' : '⚠️ Ошибка сохранения';
    saveSucceeded = Boolean(data.ok);
    debugReplay('save:response', `ok=${saveSucceeded}`);

  } catch (err) {

    console.error(err);

    statusDiv.innerText = '❌ Не удалось сохранить';
    debugReplay('save:error', err.message || 'unknown');

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
  debugReplay('save:after', `replayPoints=${replayCoordinates.length}`);
  await new Promise((resolve) => setTimeout(resolve, saveSucceeded ? 120 : 80));
  if (!saveSucceeded) {
    statusDiv.innerText = 'Подготовка воспроизведения...';
  }
  const defaultRouteName = sessionMode === 'planned_route' ? getRouteNameSafe() : 'Мой маршрут';
  const finalRouteId =
    sessionMode === 'planned_route'
      ? (session.plannedRouteId || `planned-${generatedSessionId}`)
      : `free-${generatedSessionId}`;
  showWorkoutSummaryAndReplay({
    distanceM,
    elapsedSec,
    trackCoords: replayCoordinates,
    showReplay: true,
    isSaved: saveSucceeded,
    saveMeta: {
      isSessionSaved: saveSucceeded,
      defaultRouteName,
      routeId: finalRouteId,
      sessionId: generatedSessionId
    }
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
ensureDgisApiKeyLoaded().finally(() => {
  loadUserProfileForCalories().finally(() => {
    initMap();
  });
});