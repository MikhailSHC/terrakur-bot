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

  lastProgressUpdate: 0   // время последнего обновления прогресса

};

const OFF_ROUTE_RADIUS_M = 35;
const OFF_ROUTE_GRACE_MS = 12000;
const PROGRESS_UPDATE_INTERVAL_MS = 2000;


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

const chatId      = urlParams.get('chatId') || 'test_user';
const authToken   = urlParams.get('authToken') || '';



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



// === GPS FILTERING ===



// Base parameters for filtering GPS

const BASE_MIN_DISTANCE_METERS   = 3;    // smoother visual track updates

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

let routeProgressEl = null;
let recenterBtn = null;

let lastKnownPosition = null;

let autoPausedBySystem = false;
let lastRawPoint = null;
let idleStartedAt = null;
let lastHeadingDeg = null;
let replayPanelEl = null;

const REPLAY_SOURCE_ID = 'run-replay-source';
const REPLAY_LAYER_ID = 'run-replay-line';
let redrawQueued = false;



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

    } else {

      // свободный трек

      getUserLocation();

    }

  });

}

function ensureUiEnhancements() {
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

  if (!replayPanelEl) {
    replayPanelEl = document.createElement('div');
    replayPanelEl.id = 'replayPanel';
    replayPanelEl.style.cssText =
      'position:fixed;left:16px;right:16px;bottom:150px;z-index:4;background:rgba(0,0,0,0.78);color:#fff;border-radius:16px;padding:12px 14px;display:none;';
    document.body.appendChild(replayPanelEl);
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

function updateGPSQuality(_accuracy) {
  // intentionally hidden in MVP UI to reduce visual noise
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

function processStartProximity(latitude, longitude) {
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
      processStartProximity(latitude, longitude);
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
        plannedFinish = coords[coords.length - 1]; // Последняя точка - финиш

        setStartMarker([plannedStart[0], plannedStart[1]]);
        setFinishMarker([plannedFinish[0], plannedFinish[1]]);
        
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
      processStartProximity(latitude, longitude);

      addUserMarker([longitude, latitude]);

      map.flyTo({ center: [longitude, latitude], zoom: 15 });

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
    'width:40px;height:40px;background:rgba(0,0,0,0.2);border:2px solid rgba(255,255,255,0.85);border-radius:50%;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';

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

  const el = document.createElement('div');

  el.style.cssText =
    'width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.45);';
  el.innerText = '🚩';
  el.title = 'Точка старта';

  startMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);

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
  
  const el = document.createElement('div');
  el.style.cssText =
    'width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:rgba(220,38,38,0.35);border:1px solid rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 0 8px rgba(0,0,0,0.45);';
  el.innerText = '🏁';
  el.title = 'Точка финиша';
  
  finishMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);
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

    minDistance: isWalking ? 2 : BASE_MIN_DISTANCE_METERS,

    maxSpeed: isWalking ? 4 : BASE_MAX_SPEED_M_S,             // lower max for walking

    minTime: isWalking ? 1000 : 800

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



  scheduleTrackRedraw();

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
        'line-width': 6,
        'line-opacity': 0.95
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

function animateCompletedPath(trackCoords) {
  if (!Array.isArray(trackCoords) || trackCoords.length < 2 || !map) return;

  // Hide live red track so replay animation is clearly visible.
  if (map.getSource('run-track')) {
    map.getSource('run-track').setData({
      type: 'FeatureCollection',
      features: []
    });
  }

  ensureReplayLayer();

  const totalPoints = trackCoords.length;
  const totalDurationMs = 6000;
  const frameMs = 60;
  const steps = Math.max(1, Math.round(totalDurationMs / frameMs));
  let step = 1;

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

  map.fitBounds(rawBounds, { padding: 28, duration: 550 });

  const timer = setInterval(() => {
    const progress = step / steps;
    const sliceEnd = Math.max(2, Math.floor(progress * totalPoints));
    setReplayCoordinates(trackCoords.slice(0, sliceEnd));
    step += 1;
    if (step > steps) {
      clearInterval(timer);
      setReplayCoordinates(trackCoords);
    }
  }, frameMs);
}

function showWorkoutSummaryAndReplay({ distanceM, elapsedSec, avgPaceSecPerKm, trackCoords }) {
  if (!replayPanelEl) return;
  const km = (distanceM / 1000).toFixed(2);
  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
  const paceMin = Math.floor(avgPaceSecPerKm / 60);
  const paceSec = Math.floor(avgPaceSecPerKm % 60).toString().padStart(2, '0');

  replayPanelEl.innerHTML =
    `<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Итог тренировки</div>` +
    `<div style="font-size:12px;opacity:0.95;">Дистанция: <b>${km} км</b> | Время: <b>${mins}:${secs}</b> | Темп: <b>${paceMin}'${paceSec}"</b></div>` +
    `<div style="font-size:11px;opacity:0.75;margin-top:6px;">Показываю ускоренное воспроизведение маршрута...</div>`;
  replayPanelEl.style.display = 'block';

  animateCompletedPath(trackCoords);
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
      longitude, latitude
    );

    if (distToFinish <= FINISH_RADIUS_M) {
      hasReachedFinish = true;
      statusDiv.innerText = '🏁 Финиш! Маршрут завершен!';
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



  addFilteredPoint(latitude, longitude, now, accuracy);



  const smoothed = getSmoothedPosition();

  const center   = smoothed

    ? [smoothed.lng, smoothed.lat]

    : [longitude, latitude];



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

  // Для готового маршрута: требуем дойти до старта

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
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
    hasReachedFinish = false; // Сбрасываем состояние финиша

    isPaused       = false;

    trackPoints    = [];

    totalDistanceM = 0;

    lastSavedPoint = null;
    lastRawPoint = null;
    idleStartedAt = null;
    autoPausedBySystem = false;
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

  const replayCoordinates = trackPoints.map((p) => [p.lng, p.lat]);
  showWorkoutSummaryAndReplay({
    distanceM,
    elapsedSec,
    avgPaceSecPerKm,
    trackCoords: replayCoordinates
  });

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