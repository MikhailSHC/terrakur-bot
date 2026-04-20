// app.js – TerraKur беговой трекер MVP (свободная пробежка)
let map;
let userMarker;
let watchId = null;
let isTracking = false;
let isPaused = false;
let trackPoints = [];       // массив {lat, lng, timestamp}
let startTime = null;
let pausedDuration = 0;
let pauseStart = null;
let currentPolyline = null;

// DOM элементы
const statsPanel = document.getElementById('statsPanel');
const timeEl = document.getElementById('time');
const distanceEl = document.getElementById('distance');
const paceEl = document.getElementById('pace');
const statusDiv = document.getElementById('status');
const freeRunBtn = document.getElementById('freeRunBtn');
const routesBtn = document.getElementById('routesBtn');
const historyBtn = document.getElementById('historyBtn');

// Параметры
const CHAT_ID = new URLSearchParams(window.location.search).get('chatId') || 'test_user';

// Инициализация карты (MapLibre)
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json', // бесплатный стиль без токена
    center: [42.7165, 43.9071], // Kislovodsk
    zoom: 14
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  map.on('load', () => {
    // Источник для отрисовки записанного трека
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
        'line-width': 5,
        'line-opacity': 0.9
      }
    });
    getUserLocation();
  });
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
      map.flyTo({ center: [longitude, latitude], zoom: 15 });
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

// Обновление маркера пользователя
function updateUserMarker(lngLat) {
  if (userMarker) userMarker.setLngLat(lngLat);
  else addUserMarker(lngLat);
}

// Рассчёт дистанции (гаверсинус) между двумя точками в метрах
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

// Обновление UI метрик
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

// Отрисовка трека на карте
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

// Добавление новой GPS точки
function addTrackPoint(lat, lng, timestamp) {
  trackPoints.push({ lat, lng, timestamp });
  redrawTrack();
  updateStatsUI();
}

// Старт тренировки (свободная пробежка)
function startFreeRun() {
  if (isTracking) return;
  if (!navigator.geolocation) {
    statusDiv.innerText = '❌ Геолокация недоступна';
    return;
  }
  // Сброс состояния
  isTracking = true;
  isPaused = false;
  trackPoints = [];
  startTime = Date.now();
  pausedDuration = 0;
  pauseStart = null;

  // Показать панель статистики, изменить кнопки
  statsPanel.classList.remove('hidden');
  freeRunBtn.textContent = '⏸ Пауза';
  routesBtn.disabled = true;
  historyBtn.disabled = true;

  statusDiv.innerText = '🏃 Тренировка началась...';

  // Очистить старый трек на карте
  redrawTrack();

  // Запуск watchPosition
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!isTracking || isPaused) return;
      const { latitude, longitude } = pos.coords;
      updateUserMarker([longitude, latitude]);
      addTrackPoint(latitude, longitude, Date.now());
      map.flyTo({ center: [longitude, latitude], zoom: 16, duration: 500 });
    },
    (err) => {
      console.error(err);
      statusDiv.innerText = '⚠️ Ошибка GPS';
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
  );
}

// Пауза / Возобновление
function pauseResume() {
  if (!isTracking) return;
  if (isPaused) {
    // Возобновить
    isPaused = false;
    if (pauseStart) {
      pausedDuration += (Date.now() - pauseStart);
      pauseStart = null;
    }
    freeRunBtn.textContent = '⏸ Пауза';
    statusDiv.innerText = '▶️ Продолжаем...';
    setTimeout(() => { if (statusDiv.innerText === '▶️ Продолжаем...') statusDiv.innerText = ''; }, 1500);
  } else {
    // Пауза
    isPaused = true;
    pauseStart = Date.now();
    freeRunBtn.textContent = '▶️ Старт';
    statusDiv.innerText = '⏸ Тренировка на паузе';
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Остановка тренировки и сохранение
async function stopAndSave() {
  if (!isTracking) return;
  // Остановить слежение
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  isTracking = false;
  isPaused = false;

  // Вычисляем финальную статистику
  const endTime = Date.now();
  let elapsedSec = (endTime - startTime - pausedDuration) / 1000;
  if (elapsedSec < 0) elapsedSec = 0;
  let totalDistance = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistance += haversineDistance(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
  }
  const distanceM = totalDistance;
  const avgPaceSecPerKm = (distanceM > 0) ? (elapsedSec / (distanceM / 1000)) : 0;

  // Подготовка GeoJSON трека
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

  // Отправить сессию на сервер
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: CHAT_ID,
        session: {
          startedAt: new Date(startTime).toISOString(),
          finishedAt: new Date(endTime).toISOString(),
          durationSec: elapsedSec,
          distanceM: distanceM,
          avgPaceSecPerKm: avgPaceSecPerKm,
          geojson: geojsonTrack,
          mode: 'free_run'
        }
      })
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

  // Сброс UI
  statsPanel.classList.add('hidden');
  freeRunBtn.textContent = '🏃 Свободная';
  routesBtn.disabled = false;
  historyBtn.disabled = false;
  setTimeout(() => { statusDiv.innerText = ''; }, 3000);
}

// Обработчики кнопок (динамические)
freeRunBtn.onclick = () => {
  if (!isTracking) {
    startFreeRun();
  } else {
    if (isPaused) {
      pauseResume(); // возобновить
    } else {
      // Если тренировка активна – либо пауза, либо стоп? У нас отдельной кнопки стоп нет. Добавим двойное действие?
      // По ТЗ нужны кнопки Пауза и Стоп. Для простоты: при активной тренировке кнопка "Пауза", при паузе – "Старт" и дополнительная кнопка "Стоп".
      // Но у нас только три кнопки снизу. Сделаем так: при активной тренировке показываем дополнительную плавающую кнопку "Стоп".
    }
  }
};

// Добавим отдельную кнопку "Стоп" во время тренировки (создадим динамически)
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

function removeStopButton() {
  const btn = document.getElementById('dynamicStopBtn');
  if (btn) btn.remove();
}

// Переопределим startFreeRun, чтобы добавлять кнопку Стоп
const originalStart = startFreeRun;
startFreeRun = function() {
  originalStart();
  showStopButton();
};

// При паузе/возобновлении кнопку Стоп оставляем
// При остановке она удаляется в stopAndSave

// Для совместимости с паузой – при возобновлении кнопка уже есть
// Также при остановке через стоп – кнопка удаляется

// Экспорт для глобального использования (не обязательно)
window.startFreeRun = startFreeRun;
window.pauseResume = pauseResume;
window.stopAndSave = stopAndSave;

// Заглушки для других кнопок
routesBtn.onclick = () => { statusDiv.innerText = 'Список маршрутов (скоро)'; };
historyBtn.onclick = () => { statusDiv.innerText = 'История (скоро)'; };

// Инициализация
initMap();