// app.js – TerraKur беговой трекер (улучшенный GPS-фильтр)



let map;

let userMarker;

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

let startMarker = null;    // маркер точки старта маршрута



// (опционально) запланированный маршрут

let plannedRoute = null;

let plannedStart = null;      // точка старта готового маршрута [lon, lat]

let hasReachedStart = false;  // достиг ли пользователь старта

const START_RADIUS_M = 20;    // радиус в метрах для старта



// Отслеживание прогресса по маршруту

let routeProgress = {

  currentIndex: 0,      // текущий индекс точки маршрута

  completedSegments: 0,  // сколько сегментов завершено

  totalSegments: 0,       // всего сегментов в маршруте

  isOnRoute: false,        // находится ли пользователь на маршруте

  lastProgressUpdate: 0   // время последнего обновления прогресса

};

const OFF_ROUTE_RADIUS_M = 35;
const OFF_ROUTE_GRACE_MS = 12000;
const PROGRESS_UPDATE_INTERVAL_MS = 2000;

const AUTO_PAUSE_SPEED_M_S = 0.45;
const AUTO_PAUSE_IDLE_MS = 10000;
const AUTO_RESUME_SPEED_M_S = 1.1;

const WARMUP_REQUIRED_FIXES = 3;
const WARMUP_MAX_ACCURACY_M = 20;

const CAMERA_UPDATE_INTERVAL_MS = 2500;
const CAMERA_MIN_MOVE_M = 8;



// DOM-элементы

const statsPanel   = document.getElementById('statsPanel');

const timeEl       = document.getElementById('time');

const distanceEl   = document.getElementById('distance');

const paceEl       = document.getElementById('pace');

const statusDiv    = document.getElementById('status');

const startBtn     = document.getElementById('startBtn');

// const routesBtn    = document.getElementById('routesBtn');

// const historyBtn   = document.getElementById('historyBtn');



// Параметры из URL

const urlParams   = new URLSearchParams(window.location.search);

const routeId     = urlParams.get('routeId');       // системный маршрут

const userRouteId = urlParams.get('userRouteId');   // личный маршрут

const chatId      = urlParams.get('chatId') || 'test_user';
const authToken   = urlParams.get('authToken') || '';



let sessionMode;

if (routeId || userRouteId) {

  sessionMode = 'planned_route'; // и системный, и личный – "готовые" маршруты

} else {

  sessionMode = 'free_run';

}

function getAuthHeaders() {
  if (!authToken) return {};
  return { 'x-miniapp-auth': authToken };
}



// === GPS FILTERING ===



// Base parameters for filtering GPS

const BASE_MIN_DISTANCE_METERS   = 8;    // minimum displacement to consider movement (approx. 8 m)

const BASE_MIN_TIME_MS           = 3000; // minimum 3 sec between points

const BASE_MAX_JUMP_METERS       = 60;   // outlier if too far in short interval

const BASE_MAX_ACCURACY_METERS   = 30;   // discard points with accuracy worse than 30 m

const BASE_MAX_SPEED_M_S         = 7;    // ~25 km/h - everything above is considered outlier (for running/jogging)



// Adaptive filtering state

let recentSpeeds = [];          // last few speed measurements for averaging

const SPEED_HISTORY_SIZE = 5;   // how many recent speeds to average

const WALKING_SPEED_THRESHOLD = 2; // m/s - below this is considered walking

// Таймер для UI

let uiTimerId = null;
let lastFlyTime = 0;
let lastCameraCenter = null;
let isFollowingUser = true;

let gpsQualityEl = null;
let routeProgressEl = null;
let recenterBtn = null;

let gpsWarmupGoodFixes = 0;
let gpsWarmupReady = false;
let lastKnownPosition = null;

let autoPausedBySystem = false;
let lastRawPoint = null;
let idleStartedAt = null;



// Для статуса по старту

let lastStartStatus = null;   // последнее текстовое состояние про "подойдите к старту"



// === ИНИЦИАЛИЗАЦИЯ КАРТЫ ===



function initMap() {

  map = new maplibregl.Map({

    container: 'map',

    style: {

      version: 8,

      sources: {

        osm: {

          type: 'raster',

          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],

          tileSize: 256

        }

      },

      layers: [

        { id: 'osm', type: 'raster', source: 'osm' }

      ]

    },

    center: [42.7165, 43.9071],

    zoom: 13

  });



  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.on('dragstart', () => {
    isFollowingUser = false;
  });



  map.on('load', () => {

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

        'line-width': 5

      }

    });



    if (routeId) {

      // системный маршрут из routes.geojson

      loadPlannedRoute(routeId);

    } else if (userRouteId) {

      // личный маршрут из user_data.json

      loadUserRoute(userRouteId, chatId);

    } else {

      // свободный трек

      getUserLocation();

    }

  });

}

function ensureUiEnhancements() {
  if (!gpsQualityEl) {
    gpsQualityEl = document.createElement('div');
    gpsQualityEl.id = 'gpsQuality';
    gpsQualityEl.style.cssText =
      'position:fixed;top:72px;right:16px;z-index:3;background:rgba(0,0,0,0.72);color:#fff;padding:6px 10px;border-radius:14px;font-size:11px;font-weight:600;';
    gpsQualityEl.innerText = 'GPS: ...';
    document.body.appendChild(gpsQualityEl);
  }

  if (!routeProgressEl) {
    routeProgressEl = document.createElement('div');
    routeProgressEl.id = 'routeProgress';
    routeProgressEl.style.cssText =
      'position:fixed;top:104px;left:16px;right:16px;z-index:3;background:rgba(0,0,0,0.72);color:#fff;padding:8px 12px;border-radius:16px;font-size:12px;display:none;';
    document.body.appendChild(routeProgressEl);
  }

  if (!recenterBtn) {
    recenterBtn = document.createElement('button');
    recenterBtn.id = 'recenterBtn';
    recenterBtn.textContent = '📍 Центр';
    recenterBtn.style.cssText =
      'position:fixed;bottom:160px;right:16px;z-index:3;background:rgba(0,0,0,0.75);border:none;border-radius:28px;padding:8px 14px;font-size:13px;font-weight:600;color:#fff;';
    recenterBtn.onclick = () => {
      isFollowingUser = true;
      if (lastKnownPosition) {
        const center = [lastKnownPosition.longitude, lastKnownPosition.latitude];
        map.easeTo({ center, zoom: 16, duration: 550 });
      }
    };
    document.body.appendChild(recenterBtn);
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

function updateGPSQuality(accuracy) {
  if (!gpsQualityEl) return;
  if (typeof accuracy !== 'number') {
    gpsQualityEl.innerText = 'GPS: ?';
    return;
  }
  if (accuracy <= 10) {
    gpsQualityEl.style.color = '#22c55e';
    gpsQualityEl.innerText = `GPS: отлично (${Math.round(accuracy)}м)`;
    return;
  }
  if (accuracy <= 20) {
    gpsQualityEl.style.color = '#f59e0b';
    gpsQualityEl.innerText = `GPS: средне (${Math.round(accuracy)}м)`;
    return;
  }
  gpsQualityEl.style.color = '#ef4444';
  gpsQualityEl.innerText = `GPS: слабо (${Math.round(accuracy)}м)`;
}

function smoothCameraFollow(center, now) {
  if (!map || !isFollowingUser) return;
  if (!lastCameraCenter) {
    map.easeTo({ center, zoom: 16, duration: 500 });
    lastCameraCenter = center;
    lastFlyTime = now;
    return;
  }

  const movedM = haversineDistance(lastCameraCenter[1], lastCameraCenter[0], center[1], center[0]);
  if (movedM < CAMERA_MIN_MOVE_M && now - lastFlyTime < CAMERA_UPDATE_INTERVAL_MS) {
    return;
  }

  map.easeTo({ center, zoom: 16, duration: 450 });
  lastCameraCenter = center;
  lastFlyTime = now;
}

function processWarmupAndStartProximity(latitude, longitude, accuracy) {
  if (typeof accuracy === 'number') {
    if (accuracy <= WARMUP_MAX_ACCURACY_M) {
      gpsWarmupGoodFixes += 1;
    } else {
      gpsWarmupGoodFixes = Math.max(0, gpsWarmupGoodFixes - 1);
    }
    gpsWarmupReady = gpsWarmupGoodFixes >= WARMUP_REQUIRED_FIXES;
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
      statusDiv.innerText = '✅ Вы в зоне старта маршрута, нажмите "Старт"';
    } else {
      hasReachedStart = false;
      const rounded = Math.round(distToStart / 5) * 5;
      const msg = `🏁 Подойдите к точке старта (≈ ${rounded} м)`;
      if (msg !== lastStartStatus) {
        lastStartStatus = msg;
        statusDiv.innerText = msg;
      }
    }
  }
}

function ensurePassiveLocationWatch() {
  if (!navigator.geolocation || passiveWatchId !== null) return;

  passiveWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const now = Date.now();
      lastKnownPosition = { latitude, longitude, accuracy };
      updateGPSQuality(accuracy);
      processWarmupAndStartProximity(latitude, longitude, accuracy);
      updateUserMarker([longitude, latitude]);

      if (!isTracking && isFollowingUser) {
        smoothCameraFollow([longitude, latitude], now);
      }
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



    if (!map.getSource('planned-route')) {

      map.addSource('planned-route', { type: 'geojson', data: plannedRoute });

      map.addLayer({

        id: 'planned-route-line',

        type: 'line',

        source: 'planned-route',

        paint: {

          'line-color': '#3b82f6',

          'line-width': 4,

          'line-dasharray': [2, 2]

        }

      });

    } else {

      map.getSource('planned-route').setData(plannedRoute);

    }



    const coords = getRouteLineCoordinates();

    const center = coords[Math.floor(coords.length / 2)];

    

    // Находим ближайшую точку маршрута к пользователю

    let nearestPoint = coords[0];

    let minDistance = Infinity;

    

    // Получаем текущее местоположение пользователя для определения ближайшей точки

    navigator.geolocation.getCurrentPosition(

      (pos) => {

        const userLat = pos.coords.latitude;

        const userLng = pos.coords.longitude;

        

        // Ищем ближайшую точку маршрута к пользователю

        for (let i = 0; i < coords.length; i++) {

          const dist = haversineDistance(userLat, userLng, coords[i][1], coords[i][0]);

          if (dist < minDistance) {

            minDistance = dist;

            nearestPoint = coords[i];

          }

        }

        

        plannedStart = nearestPoint;

        setStartMarker([plannedStart[0], plannedStart[1]]);

        

        // Центрируем карту между пользователем и ближайшей точкой

        const mapCenter = [(userLng + plannedStart[0]) / 2, (userLat + plannedStart[1]) / 2];

        map.flyTo({ center: mapCenter, zoom: 14 });

        

        const distanceToStart = Math.round(minDistance);

        statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен. Ближайшая точка старта в ${distanceToStart}м. Подойдите и нажмите "Старт"`;

        setTimeout(() => {

          if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

        }, 4000);

      },

      (err) => {

        console.error('Ошибка получения местоположения:', err);

        // Если не удалось получить местоположение, используем первую точку

        plannedStart = coords[0];

        setStartMarker([plannedStart[0], plannedStart[1]]);

        map.flyTo({ center: [center[0], center[1]], zoom: 14 });

        statusDiv.innerText = `✅ Маршрут "${getRouteNameSafe()}" загружен. Подойдите к точке старта и нажмите "Старт"`;

        setTimeout(() => {

          if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

        }, 3000);

      },

      { enableHighAccuracy: true, timeout: 5000 }

    );

    setTimeout(() => {

      if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

    }, 3000);



    getUserLocation();

  } catch (err) {

    console.error(err);

    statusDiv.innerText = '❌ Ошибка загрузки маршрута';

  }

}



// === ЗАГРУЗКА ПОЛЬЗОВАТЕЛЬСКОГО МАРШРУТА (userRoutes) ===



async function loadUserRoute(id, chatId) {

  try {

    statusDiv.innerText = 'Загрузка вашего маршрута...';

    const res  = await fetch(
      `/api/user-routes/${encodeURIComponent(id)}?chatId=${encodeURIComponent(chatId)}`,
      { headers: getAuthHeaders() }
    );

    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Unknown error');



    const userRoute = data.route;

    // userRoute.geojson — FeatureCollection с LineString

    plannedRoute = userRoute.geojson;



    const lineFeature = plannedRoute.features[0];

    const coords = lineFeature.geometry.coordinates;



    // Находим ближайшую точку маршрута к пользователю

    let nearestPoint = coords[0];

    let minDistance = Infinity;

    

    // Получаем текущее местоположение пользователя для определения ближайшей точки

    navigator.geolocation.getCurrentPosition(

      (pos) => {

        const userLat = pos.coords.latitude;

        const userLng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        lastKnownPosition = { latitude: userLat, longitude: userLng, accuracy };
        updateGPSQuality(accuracy);

        

        // Ищем ближайшую точку маршрута к пользователю

        for (let i = 0; i < coords.length; i++) {

          const dist = haversineDistance(userLat, userLng, coords[i][1], coords[i][0]);

          if (dist < minDistance) {

            minDistance = dist;

            nearestPoint = coords[i];

          }

        }

        

        plannedStart = nearestPoint;

        setStartMarker([plannedStart[0], plannedStart[1]]);

        

        // Центрируем карту между пользователем и ближайшей точкой

        const mapCenter = [(userLng + plannedStart[0]) / 2, (userLat + plannedStart[1]) / 2];

        map.flyTo({ center: mapCenter, zoom: 14 });

        

        const distanceToStart = Math.round(minDistance);

        statusDiv.innerText = `✅ Ваш маршрут загружен. Ближайшая точка старта в ${distanceToStart}м. Подойдите и нажмите "Старт"`;

        setTimeout(() => {

          if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

        }, 4000);

      },

      (err) => {

        console.error('Ошибка получения местоположения:', err);

        // Если не удалось получить местоположение, используем первую точку

        plannedStart = coords[0];

        setStartMarker([plannedStart[0], plannedStart[1]]);

        map.flyTo({ center: [coords[Math.floor(coords.length / 2)][0], coords[Math.floor(coords.length / 2)][1]], zoom: 14 });

        statusDiv.innerText = '✅ Ваш маршрут загружен. Подойдите к точке старта и нажмите "Старт"';

        setTimeout(() => {

          if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = '';

        }, 3000);

      },

      { enableHighAccuracy: true, timeout: 5000 }

    );



    getUserLocation();

  } catch (err) {

    console.error(err);

    statusDiv.innerText = '❌ Ошибка загрузки вашего маршрута';

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

      const { latitude, longitude, accuracy } = pos.coords;
      lastKnownPosition = { latitude, longitude, accuracy };
      updateGPSQuality(accuracy);
      processWarmupAndStartProximity(latitude, longitude, accuracy);

      addUserMarker([longitude, latitude]);

      map.flyTo({ center: [longitude, latitude], zoom: 15 });

      if (gpsWarmupReady) {
        statusDiv.innerText = '✅ GPS готов, можно стартовать';
      } else {
        statusDiv.innerText = `📡 Стабилизация GPS (${gpsWarmupGoodFixes}/${WARMUP_REQUIRED_FIXES})...`;
      }

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
  let minDistance = Infinity;
  for (let i = 0; i < coords.length; i += 1) {
    const d = haversineDistance(lat, lng, coords[i][1], coords[i][0]);
    if (d < minDistance) {
      minDistance = d;
      closestIndex = i;
    }
  }

  let distanceDoneM = 0;
  for (let i = 1; i <= closestIndex; i += 1) {
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
  routeProgress.completedSegments = Math.max(0, closestIndex);
  routeProgress.distanceDoneM = distanceDoneM;
  routeProgress.distanceRemainingM = distanceRemainingM;
  routeProgress.completionPercent = completionPercent;
  routeProgress.lastProgressUpdate = now;

  if (minDistance > OFF_ROUTE_RADIUS_M) {
    if (!routeProgress.offRouteSince) {
      routeProgress.offRouteSince = now;
    } else if (now - routeProgress.offRouteSince > OFF_ROUTE_GRACE_MS) {
      statusDiv.innerText = '⚠️ Вы отклонились от маршрута. Вернитесь к синей линии.';
    }
  } else {
    if (routeProgress.offRouteSince && now - routeProgress.offRouteSince > OFF_ROUTE_GRACE_MS) {
      statusDiv.innerText = '✅ Вы снова на маршруте';
    }
    routeProgress.offRouteSince = null;
  }

  if (routeProgressEl) {
    routeProgressEl.style.display = 'block';
    routeProgressEl.innerText = `Прогресс: ${completionPercent}% | Осталось: ${(distanceRemainingM / 1000).toFixed(2)} км`;
  }
}


// === МАРКЕРЫ ===



function addUserMarker(lngLat) {

  if (userMarker) userMarker.remove();

  const el = document.createElement('div');

  el.style.cssText =

    'width:24px;height:24px;background:#2ecc71;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5);';

  userMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);

}



function updateUserMarker(lngLat) {

  if (userMarker) userMarker.setLngLat(lngLat);

  else addUserMarker(lngLat);

}



function setStartMarker(lngLat) {

  if (startMarker) {

    startMarker.setLngLat(lngLat);

    return;

  }

  const el = document.createElement('div');

  el.style.cssText =

    'width:18px;height:18px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.4);';

  startMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);

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

  const isWalking = avgSpeed < WALKING_SPEED_THRESHOLD;

  

  return {

    maxAccuracy: isWalking ? 20 : BASE_MAX_ACCURACY_METERS,  // stricter for walking

    maxJump: isWalking ? 30 : BASE_MAX_JUMP_METERS,           // smaller jumps for walking

    minDistance: isWalking ? 3 : BASE_MIN_DISTANCE_METERS,   // more precise for walking

    maxSpeed: isWalking ? 4 : BASE_MAX_SPEED_M_S,             // lower max for walking

    minTime: isWalking ? 2000 : BASE_MIN_TIME_MS              // more frequent for walking

  };

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



  redrawTrack();

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



  let pace = 0;

  if (totalDistanceM > 0 && elapsedSec > 0) {

    pace = (elapsedSec / 60) / (totalDistanceM / 1000);

  }

  const paceMin = Math.floor(pace);

  const paceSec = Math.floor((pace - paceMin) * 60);

  paceEl.textContent = `${paceMin}'${paceSec.toString().padStart(2, '0')}"`;



}



function redrawTrack() {

  if (!map || !map.getSource('run-track')) return;



  const coordinates = trackPoints.map(p => [p.lng, p.lat]);



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



  const { latitude, longitude, accuracy } = pos.coords;
  lastKnownPosition = { latitude, longitude, accuracy };
  updateGPSQuality(accuracy);

  const now = Date.now();

  if (lastRawPoint) {
    const dt = now - lastRawPoint.timestamp;
    const rawDist = haversineDistance(lastRawPoint.lat, lastRawPoint.lng, latitude, longitude);
    const rawSpeed = dt > 0 ? rawDist / (dt / 1000) : 0;

    if (!isPaused && rawSpeed < AUTO_PAUSE_SPEED_M_S) {
      if (!idleStartedAt) idleStartedAt = now;
      if (now - idleStartedAt > AUTO_PAUSE_IDLE_MS) {
        isPaused = true;
        autoPausedBySystem = true;
        pauseStart = now;
        startBtn.textContent = '▶️ Старт';
        statusDiv.innerText = '⏸ Автопауза';
      }
    } else if (isPaused && autoPausedBySystem && rawSpeed > AUTO_RESUME_SPEED_M_S) {
      isPaused = false;
      autoPausedBySystem = false;
      if (pauseStart) {
        pausedDuration += now - pauseStart;
        pauseStart = null;
      }
      startBtn.textContent = '⏸ Пауза';
      statusDiv.innerText = '▶️ Автопродолжение';
      idleStartedAt = null;
    } else if (rawSpeed >= AUTO_PAUSE_SPEED_M_S) {
      idleStartedAt = null;
    }
  }
  lastRawPoint = { lat: latitude, lng: longitude, timestamp: now };

  if (isPaused && !autoPausedBySystem) return;
  if (isPaused && autoPausedBySystem) {
    updateUserMarker([longitude, latitude]);
    return;
  }



  addFilteredPoint(latitude, longitude, now, accuracy);



  const smoothed = getSmoothedPosition();

  const center   = smoothed

    ? [smoothed.lng, smoothed.lat]

    : [longitude, latitude];



  updateUserMarker(center);



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

      initializeRouteProgress(); // инициализируем отслеживание прогресса

      statusDiv.innerText = '✅ Вы в зоне старта маршрута, можно начинать';

      setTimeout(() => {

        if (statusDiv.innerText.includes('зоне старта')) {

          statusDiv.innerText = '';

        }

      }, 3000);

    } else {

      const rounded = Math.round(distToStart / 5) * 5;

      const msg = `🏁 Подойдите к точке старта (≈ ${rounded} м)`;

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



  if (!navigator.geolocation) {

    statusDiv.innerText = '❌ Геолокация недоступна';

    return;

  }

  if (!gpsWarmupReady) {
    statusDiv.innerText = `📡 Подождите стабилизацию GPS (${gpsWarmupGoodFixes}/${WARMUP_REQUIRED_FIXES})`;
    return;
  }



  // Для готового маршрута: требуем дойти до старта

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
    if (lastKnownPosition) {
      processWarmupAndStartProximity(
        lastKnownPosition.latitude,
        lastKnownPosition.longitude,
        lastKnownPosition.accuracy
      );
    }
    if (hasReachedStart) {
      // fall through and start tracking
    } else {
      statusDiv.innerText = '🏁 Сначала подойдите к точке старта маршрута (синяя линия на карте)';
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

    isPaused       = false;

    trackPoints    = [];

    totalDistanceM = 0;

    lastSavedPoint = null;
    lastRawPoint = null;
    idleStartedAt = null;
    autoPausedBySystem = false;



    startTime      = Date.now();

    pausedDuration = 0;

    pauseStart     = null;



    statsPanel.classList.remove('hidden');

    startBtn.textContent = '⏸ Пауза';



    statusDiv.innerText = '🏃 Тренировка началась...';



    redrawTrack();



    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(

      onGPSPosition,

      (err) => console.error(err),

      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }

    );



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



    if (watchId === null) {

      watchId = navigator.geolocation.watchPosition(

        onGPSPosition,

        (err) => console.error(err),

        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }

      );

    }

  }

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

  }

}



async function stopAndSave() {

  if (!isTracking) return;



  if (watchId !== null) {

    navigator.geolocation.clearWatch(watchId);

    watchId = null;

  }



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

    const stopBtn = document.getElementById('dynamicStopBtn');

    if (stopBtn) stopBtn.remove();

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

    geojson: geojsonTrack,

    mode: sessionMode

  };



  if (sessionMode === 'planned_route') {

    if (routeId) {

      // системный маршрут

      if (plannedRoute && plannedRoute.properties && plannedRoute.properties.id) {

        session.plannedRouteId = plannedRoute.properties.id;

      } else {

        session.plannedRouteId = routeId;

      }

    } else if (userRouteId) {

      // личный маршрут

      session.userRouteId = userRouteId;

    }

  }



  try {

    const res  = await fetch('/api/sessions', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },

      body: JSON.stringify({ chatId, authToken, session })

    });

    const data = await res.json();

    statusDiv.innerText = data.ok

      ? '✅ Тренировка сохранена!'

      : '⚠️ Ошибка сохранения';

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



  const stopBtn = document.getElementById('dynamicStopBtn');

  if (stopBtn) stopBtn.remove();



  if (uiTimerId !== null) {

    clearInterval(uiTimerId);

    uiTimerId = null;

  }

  if (routeProgressEl) {
    routeProgressEl.style.display = 'none';
  }

  ensurePassiveLocationWatch();

}



// === КНОПКИ ===



function startTrackingFlow() {
  startRun();
  showStopButton();
}

startBtn.onclick = () => (isTracking ? pauseResume() : startTrackingFlow());

// routesBtn.onclick  = () => { statusDiv.innerText = 'Выберите маршрут в боте'; };

// historyBtn.onclick = () => { statusDiv.innerText = 'История тренировок (скоро)'; };



// Дополнительная кнопка "Стоп"

function showStopButton() {

  if (document.getElementById('dynamicStopBtn')) return;

  const stopBtn = document.createElement('button');

  stopBtn.id = 'dynamicStopBtn';

  stopBtn.textContent = '⏹️ Стоп';

  stopBtn.style.cssText =

    'position:fixed;bottom:100px;right:16px;z-index:3;background:#e74c3c;border:none;border-radius:40px;padding:10px 20px;font-weight:600;color:white;';

  document.body.appendChild(stopBtn);

  stopBtn.onclick = () => {

    stopAndSave();

    stopBtn.remove();

  };

}



// Старт приложения

ensureUiEnhancements();
initMap();