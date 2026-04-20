// app.js – TerraKur беговой трекер (улучшенный GPS-фильтр)

let map;
let userMarker;
let watchId = null;

// Состояние тренировки
let isTracking = false;
let isPaused = false;
let trackPoints = [];      // { lat, lng, timestamp, accuracy }
let totalDistanceM = 0;    // накопленная дистанция в метрах
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let lastSavedPoint = null;

// (опционально) запланированный маршрут
let plannedRoute = null;
let plannedStart = null;      // точка старта готового маршрута [lon, lat]
let hasReachedStart = false;  // достиг ли пользователь старта
const START_RADIUS_M = 50;    // радиус в метрах для старта

// DOM-элементы
const statsPanel   = document.getElementById('statsPanel');
const timeEl       = document.getElementById('time');
const distanceEl   = document.getElementById('distance');
const paceEl       = document.getElementById('pace');
const statusDiv    = document.getElementById('status');
const startBtn     = document.getElementById('startBtn');
const routesBtn    = document.getElementById('routesBtn');
const historyBtn   = document.getElementById('historyBtn');

// Параметры из URL
const urlParams   = new URLSearchParams(window.location.search);
const routeId     = urlParams.get('routeId');
const chatId      = urlParams.get('chatId') || 'test_user';
const sessionMode = routeId ? 'planned_route' : 'free_run';

// Параметры фильтрации GPS
const MIN_DISTANCE_METERS   = 8;    // минимальное смещение, чтобы считать движение (≈8 м)
const MIN_TIME_MS           = 3000; // минимум 3 сек между точками
const MAX_JUMP_METERS       = 60;   // выброс, если слишком далеко за короткий интервал
const MAX_ACCURACY_METERS   = 30;   // отбрасываем точки с точностью хуже 30 м
const MAX_SPEED_M_S         = 7;    // ~25 км/ч – всё выше считаем выбросом (для бега/джоггинга)

// Для карты (ограничение частоты плавного flyTo)
let lastFlyTime    = 0;
const FLY_INTERVAL_MS = 5000;

// Таймер для UI
let uiTimerId = null;

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
      loadPlannedRoute(routeId);
    } else {
      getUserLocation();
    }
  });
}

// === ЗАГРУЗКА МАРШРУТА (ОПЦИОНАЛЬНО) ===

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
    }

    const coords = plannedRoute.geometry.coordinates;
    const center = coords[Math.floor(coords.length / 2)];
    plannedStart = coords[0];

    map.flyTo({ center: [center[0], center[1]], zoom: 14 });

    statusDiv.innerText = `✅ Маршрут "${plannedRoute.properties.name}" загружен. Подойдите к точке старта и нажмите "Старт"`;
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
      const { latitude, longitude } = pos.coords;
      addUserMarker([longitude, latitude]);
      map.flyTo({ center: [longitude, latitude], zoom: 15 });
      statusDiv.innerText = '✅ Готов к тренировке';
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
}

// === МАРКЕР ===

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

// === ЛОГИКА ФИЛЬТРАЦИИ GPS ===

function shouldSavePoint(lat, lng, now, accuracy) {
  if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_METERS) {
    console.warn(`Точка отброшена по accuracy = ${accuracy.toFixed(1)} м`);
    return false;
  }

  if (!lastSavedPoint) return true;

  const dist     = haversineDistance(lastSavedPoint.lat, lastSavedPoint.lng, lat, lng);
  const timeDiff = now - lastSavedPoint.timestamp;

  if (timeDiff > 0) {
    const speed = dist / (timeDiff / 1000);
    if (speed > MAX_SPEED_M_S && dist > MIN_DISTANCE_METERS) {
      console.warn(`Выброс по скорости: ${speed.toFixed(1)} м/с (dist=${dist.toFixed(1)} м, dt=${timeDiff} мс, acc=${accuracy})`);
      return false;
    }
  }

  if (dist > MAX_JUMP_METERS && timeDiff < MIN_TIME_MS) {
    console.warn(`Выброс GPS: ${dist.toFixed(1)} м за ${timeDiff} мс (acc=${accuracy})`);
    return false;
  }

  return dist >= MIN_DISTANCE_METERS || timeDiff >= MIN_TIME_MS;
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
  if (!isTracking || isPaused) return;

  const { latitude, longitude, accuracy } = pos.coords;
  const now = Date.now();

  const accepted = addFilteredPoint(latitude, longitude, now, accuracy);

  const smoothed = getSmoothedPosition();
  const center   = smoothed
    ? [smoothed.lng, smoothed.lat]
    : [longitude, latitude];

  updateUserMarker(center);

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
    const distToStart = haversineDistance(
      plannedStart[1], plannedStart[0],
      center[1], center[0]
    );

    if (distToStart <= START_RADIUS_M) {
      hasReachedStart = true;
      statusDiv.innerText = '✅ Вы на старте маршрута, можно бежать!';
      setTimeout(() => {
        if (statusDiv.innerText.includes('старте маршрута')) {
          statusDiv.innerText = '';
        }
      }, 3000);
    } else {
      statusDiv.innerText = `🏁 Подойдите к точке старта (≈ ${distToStart.toFixed(0)} м)`;
    }
  }

  if (now - lastFlyTime > FLY_INTERVAL_MS) {
    map.flyTo({ center, zoom: 16, duration: 500 });
    lastFlyTime = now;
  } else {
    map.jumpTo({ center, zoom: 16 });
  }
}

// === СТАРТ / ПАУЗА / СТОП ===

function startRun() {
  if (isTracking) return;

  if (!navigator.geolocation) {
    statusDiv.innerText = '❌ Геолокация недоступна';
    return;
  }

  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
    statusDiv.innerText = '🏁 Сначала подойдите к точке старта маршрута (синяя линия на карте)';
    return;
  }

  isTracking     = true;
  isPaused       = false;
  trackPoints    = [];
  totalDistanceM = 0;
  lastSavedPoint = null;

  startTime      = Date.now();
  pausedDuration = 0;
  pauseStart     = null;

  statsPanel.classList.remove('hidden');
  startBtn.textContent = '⏸ Пауза';
  routesBtn.disabled   = true;
  historyBtn.disabled  = true;

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
}

function pauseResume() {
  if (!isTracking) return;

  if (isPaused) {
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
  } else {
    isPaused   = true;
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

  const endTime  = Date.now();
  let elapsedSec = (endTime - startTime - pausedDuration) / 1000;
  if (elapsedSec < 0) elapsedSec = 0;

  const distanceM       = totalDistanceM;
  const avgPaceSecPerKm =
    distanceM > 0 ? elapsedSec / (distanceM / 1000) : 0;

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
    if (plannedRoute && plannedRoute.properties && plannedRoute.properties.id) {
      session.plannedRouteId = plannedRoute.properties.id;
    } else if (routeId) {
      session.plannedRouteId = routeId;
    }
  }

  try {
    const res  = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, session })
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
  routesBtn.disabled     = false;
  historyBtn.disabled    = false;

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
}

// === КНОПКИ ===

startBtn.onclick   = () => (isTracking ? pauseResume() : startRun());
routesBtn.onclick  = () => { statusDiv.innerText = 'Выберите маршрут в боте'; };
historyBtn.onclick = () => { statusDiv.innerText = 'История тренировок (скоро)'; };

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

// Обёртка для старта, чтобы всегда добавлять кнопку Стоп
const originalStartRun = startRun;
startRun = function () {
  originalStartRun();
  showStopButton();
};

// Старт приложения
initMap();