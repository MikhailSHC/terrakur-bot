// app.js – TerraKur беговой трекер MVP (свободная + маршрут из URL)
let map;
let userMarker;
let watchId = null;
let isTracking = false;
let isPaused = false;
let trackPoints = [];
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let currentPolyline = null;

// Данные маршрута (если передан routeId)
let plannedRoute = null;        // GeoJSON Feature
let plannedRouteLayerId = 'planned-route';

// DOM элементы
const statsPanel = document.getElementById('statsPanel');
const timeEl = document.getElementById('time');
const distanceEl = document.getElementById('distance');
const paceEl = document.getElementById('pace');
const statusDiv = document.getElementById('status');
const freeRunBtn = document.getElementById('freeRunBtn');
const routesBtn = document.getElementById('routesBtn');
const historyBtn = document.getElementById('historyBtn');

// Получение параметров из URL
const urlParams = new URLSearchParams(window.location.search);
const routeId = urlParams.get('routeId');
const chatId = urlParams.get('chatId') || 'test_user';

// Инициализация карты (MapLibre)
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
    center: [42.7165, 43.9071],
    zoom: 14
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    // Источник для отрисовки записанного трека (красная линия)
    map.addSource('run-track', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
      id: 'run-line',
      type: 'line',
      source: 'run-track',
      paint: { 'line-color': '#ff4d4d', 'line-width': 5, 'line-opacity': 0.9 }
    });

    // Если передан routeId – загружаем маршрут
    if (routeId) {
      loadPlannedRoute(routeId);
    } else {
      getUserLocation();
    }
  });
}

// Загрузка маршрута по ID
async function loadPlannedRoute(id) {
  try {
    statusDiv.innerText = 'Загрузка маршрута...';
    const response = await fetch(`/api/routes/${id}/geojson`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error);
    plannedRoute = data.route;
    // Отображаем маршрут на карте
    addPlannedRouteToMap(plannedRoute);
    // Центрируем карту на маршруте
    const coords = plannedRoute.geometry.coordinates;
    const center = coords[Math.floor(coords.length / 2)];
    map.flyTo({ center: [center[0], center[1]], zoom: 14 });
    statusDiv.innerText = `✅ Маршрут "${plannedRoute.properties.name}" загружен. Нажмите "Старт"`;
    setTimeout(() => { if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = ''; }, 3000);
    getUserLocation();
  } catch (err) {
    console.error(err);
    statusDiv.innerText = '❌ Ошибка загрузки маршрута';
  }
}

// Добавление планового маршрута на карту (синяя линия)
function addPlannedRouteToMap(route) {
  if (!map.getSource('planned-route')) {
    map.addSource('planned-route', {
      type: 'geojson',
      data: route
    });
    map.addLayer({
      id: 'planned-route-line',
      type: 'line',
      source: 'planned-route',
      paint: {
        'line-color': '#3b82f6',
        'line-width': 4,
        'line-opacity': 0.8,
        'line-dasharray': [2, 2]  // пунктир для отличия
      }
    });
  } else {
    map.getSource('planned-route').setData(route);
  }
}

// Запрос геолокации и центрирование
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
      statusDiv.innerText = '✅ Готов к тренировке';
      setTimeout(() => { if (statusDiv.innerText === '✅ Готов к тренировке') statusDiv.innerText = ''; }, 2000);
    },
    (err) => {
      console.error(err);
      statusDiv.innerText = '❌ Нет доступа к геолокации. Разрешите в браузере.';
    },
    { enableHighAccuracy: true }
  );
}

function addUserMarker(lngLat) {
  if (userMarker) userMarker.remove();
  const el = document.createElement('div');
  el.style.width = '24px';
  el.style.height = '24px';
  el.style.background = '#2ecc71';
  el.style.border = '3px solid white';
  el.style.borderRadius = '50%';
  el.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
  userMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);
}

function updateUserMarker(lngLat) {
  if (userMarker) userMarker.setLngLat(lngLat);
  else addUserMarker(lngLat);
}

// Расчёт дистанции (метры)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Обновление UI статистики
function updateStatsUI() {
  if (!startTime || isPaused || !isTracking) return;
  const now = Date.now();
  let elapsedSec = (now - startTime - pausedDuration) / 1000;
  if (elapsedSec < 0) elapsedSec = 0;
  const hours = Math.floor(elapsedSec / 3600);
  const minutes = Math.floor((elapsedSec % 3600) / 60);
  const seconds = Math.floor(elapsedSec % 60);
  timeEl.textContent = hours ? `${hours}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}` : `${minutes}:${seconds.toString().padStart(2,'0')}`;

  let totalDistance = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistance += haversineDistance(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
  }
  const distanceKm = totalDistance / 1000;
  distanceEl.textContent = distanceKm.toFixed(2);

  let pace = 0;
  if (totalDistance > 0 && elapsedSec > 0) {
    pace = (elapsedSec / 60) / (totalDistance / 1000);
  }
  const paceMin = Math.floor(pace);
  const paceSec = Math.floor((pace - paceMin) * 60);
  paceEl.textContent = `${paceMin}'${paceSec.toString().padStart(2,'0')}"`;
}

// Отрисовка реального трека
function redrawTrack() {
  if (!map.getSource('run-track')) return;
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trackPoints.map(p => [p.lng, p.lat])
      },
      properties: {}
    }]
  };
  map.getSource('run-track').setData(geojson);
}

function addTrackPoint(lat, lng, timestamp) {
  trackPoints.push({ lat, lng, timestamp });
  redrawTrack();
  updateStatsUI();
}

// Старт тренировки (общий для свободной и по маршруту)
function startRun() {
  if (isTracking) return;
  if (!navigator.geolocation) {
    statusDiv.innerText = '❌ Геолокация недоступна';
    return;
  }
  isTracking = true;
  isPaused = false;
  trackPoints = [];
  startTime = Date.now();
  pausedDuration = 0;
  pauseStart = null;

  statsPanel.classList.remove('hidden');
  freeRunBtn.textContent = '⏸ Пауза';
  routesBtn.disabled = true;
  historyBtn.disabled = true;

  statusDiv.innerText = '🏃 Тренировка началась...';

  redrawTrack();

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!isTracking || isPaused) return;
      const { latitude, longitude } = pos.coords;
      updateUserMarker([longitude, latitude]);
      addTrackPoint(latitude, longitude, Date.now());
      map.flyTo({ center: [longitude, latitude], zoom: 16, duration: 500 });
    },
    (err) => console.error(err),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
  );
}

// Пауза / Возобновление
function pauseResume() {
  if (!isTracking) return;
  if (isPaused) {
    isPaused = false;
    if (pauseStart) {
      pausedDuration += (Date.now() - pauseStart);
      pauseStart = null;
    }
    freeRunBtn.textContent = '⏸ Пауза';
    statusDiv.innerText = '▶️ Продолжаем...';
    setTimeout(() => { if (statusDiv.innerText === '▶️ Продолжаем...') statusDiv.innerText = ''; }, 1500);
    // Возобновляем watchPosition
    if (watchId === null) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => { /* та же логика */ },
        (err) => console.error(err),
        { enableHighAccuracy: true }
      );
    }
  } else {
    isPaused = true;
    pauseStart = Date.now();
    freeRunBtn.textContent = '▶️ Старт';
    statusDiv.innerText = '⏸ Тренировка на паузе';
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }
}

// Остановка и сохранение сессии
async function stopAndSave() {
  if (!isTracking) return;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  isTracking = false;
  isPaused = false;

  const endTime = Date.now();
  let elapsedSec = (endTime - startTime - pausedDuration) / 1000;
  if (elapsedSec < 0) elapsedSec = 0;
  let totalDistance = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistance += haversineDistance(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
  }
  const distanceM = totalDistance;
  const avgPaceSecPerKm = (distanceM > 0) ? (elapsedSec / (distanceM / 1000)) : 0;

  const geojsonTrack = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trackPoints.map(p => [p.lng, p.lat])
      },
      properties: { startTime: startTime, endTime: endTime }
    }]
  };

  const session = {
    startedAt: new Date(startTime).toISOString(),
    finishedAt: new Date(endTime).toISOString(),
    durationSec: elapsedSec,
    distanceM: distanceM,
    avgPaceSecPerKm: avgPaceSecPerKm,
    geojson: geojsonTrack,
    mode: plannedRoute ? 'planned_route' : 'free_run'
  };
  if (plannedRoute) {
    session.plannedRouteId = plannedRoute.properties.id;
  }

  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, session })
    });
    const data = await response.json();
    if (data.ok) {
      statusDiv.innerText = '✅ Тренировка сохранена!';
    } else {
      statusDiv.innerText = '⚠️ Ошибка сохранения';
    }
  } catch (err) {
    console.error(err);
    statusDiv.innerText = '❌ Не удалось сохранить';
  }

  statsPanel.classList.add('hidden');
  freeRunBtn.textContent = '🏃 Свободная';
  routesBtn.disabled = false;
  historyBtn.disabled = false;
  setTimeout(() => { statusDiv.innerText = ''; }, 3000);
}

// Кнопка "Свободная" – начинает свободную пробежку (без маршрута)
freeRunBtn.onclick = () => {
  if (isTracking) {
    // Если уже идёт тренировка – пауза/возобновление
    pauseResume();
  } else {
    // Если нет активной тренировки – начинаем свободную
    // Если был выбран маршрут, можно его сбросить? Пока просто начинаем.
    startRun();
  }
};

// Кнопка "Маршруты" – заглушка (т.к. выбор в боте)
routesBtn.onclick = () => {
  statusDiv.innerText = 'Выбор маршрута осуществляется в боте';
};

historyBtn.onclick = () => {
  statusDiv.innerText = 'История тренировок (скоро)';
};

// Кнопка Стоп (динамическая)
function showStopButton() {
  let stopBtn = document.getElementById('dynamicStopBtn');
  if (!stopBtn) {
    stopBtn = document.createElement('button');
    stopBtn.id = 'dynamicStopBtn';
    stopBtn.textContent = '⏹️ Стоп';
    stopBtn.style.position = 'fixed';
    stopBtn.style.bottom = '100px';
    stopBtn.style.right = '16px';
    stopBtn.style.zIndex = '3';
    stopBtn.style.background = '#e74c3c';
    document.body.appendChild(stopBtn);
    stopBtn.onclick = () => {
      stopAndSave();
      stopBtn.remove();
    };
  }
}

// Переопределим startRun, чтобы добавлять кнопку Стоп
const originalStartRun = startRun;
window.startRun = function() {
  originalStartRun();
  showStopButton();
};
startRun = window.startRun;

// Инициализация
initMap();