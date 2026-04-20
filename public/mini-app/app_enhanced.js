// app.js – TerraKur беговый трекер (УЛУЧШЕННАЯ ВЕРСИЯ)

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
let startMarker = null;    // маркер точки старта маршрута
let finishMarker = null;   // маркер точки финиша

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

// GPS качество индикатор
let gpsQualityIndicator = null;
let currentAccuracy = null;

// DOM-элементы
const statsPanel   = document.getElementById('statsPanel');
const timeEl       = document.getElementById('time');
const distanceEl   = document.getElementById('distance');
const paceEl       = document.getElementById('pace');
const statusDiv    = document.getElementById('status');
const startBtn     = document.getElementById('startBtn');

// Новые элементы для улучшений
const remainingDistanceEl = document.getElementById('remainingDistance');
const currentPaceEl = document.getElementById('currentPace');

// Параметры из URL
const urlParams   = new URLSearchParams(window.location.search);
const routeId     = urlParams.get('routeId');       // системный маршрут
const userRouteId = urlParams.get('userRouteId');   // личный маршрут
const chatId      = urlParams.get('chatId') || 'test_user';

let sessionMode;
if (routeId || userRouteId) {
  sessionMode = 'planned_route'; // и системный, и личный – "готовые" маршруты
} else {
  sessionMode = 'free_run';
}

// === GPS FILTERING ===

// Base parameters for filtering GPS
const BASE_MIN_DISTANCE_METERS   = 8;    // minimum displacement to consider movement (approx. 8 m)
const BASE_MIN_TIME_MS           = 3000; // minimum 3 sec between points
const BASE_MAX_JUMP_METERS       = 60;   // outlier if too far in short interval
const BASE_MAX_ACCURACY_METERS   = 30;   // discard points with accuracy worse than 30 m
const BASE_MAX_SPEED_M_S         = 7;    // ~25 km/h - everything above is considered outlier (for running/jogging)

// Adaptive filtering state
let currentSpeed = 0;           // current speed in m/s
let recentSpeeds = [];          // last few speed measurements for averaging
const SPEED_HISTORY_SIZE = 5;   // how many recent speeds to average
const WALKING_SPEED_THRESHOLD = 2; // m/s - below this is considered walking
const CURRENT_PACE_POINTS = 5;   // количество точек для расчета текущего темпа

// Таймер для UI
let uiTimerId = null;

// Параметры карты
const FLY_INTERVAL_MS = 5000;  // интервал для flyTo анимации
let lastFlyTime = 0;           // время последнего flyTo

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

  map.on('load', () => {
    // Исходники для различных слоев
    map.addSource('run-track', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addSource('completed-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Слой записанного трека (красный)
    map.addLayer({
      id: 'run-line',
      type: 'line',
      source: 'run-track',
      paint: {
        'line-color': '#ff4d4d',
        'line-width': 5
      }
    });

    // Слой пройденной части маршрута (зеленый)
    map.addLayer({
      id: 'completed-route-line',
      type: 'line',
      source: 'completed-route',
      paint: {
        'line-color': '#22c55e',
        'line-width': 6
      }
    });

    // Создаем индикатор GPS качества
    createGPSQualityIndicator();

    if (routeId) {
      loadPlannedRoute(routeId);
    } else if (userRouteId) {
      loadUserRoute(userRouteId, chatId);
    } else {
      getUserLocation();
    }
  });
}

// === СОЗДАНИЕ ИНДИКАТОРОВ ===

function createGPSQualityIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'gps-quality-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #22c55e;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 1000;
    transition: background 0.3s ease;
  `;
  document.body.appendChild(indicator);
  gpsQualityIndicator = indicator;
}

function updateGPSQualityIndicator(accuracy) {
  if (!gpsQualityIndicator) return;
  
  currentAccuracy = accuracy;
  let color, status;
  
  if (accuracy < 15) {
    color = '#22c55e'; // зеленый
    status = 'GPS точность отличная';
  } else if (accuracy <= 30) {
    color = '#eab308'; // желтый
    status = 'GPS точность средняя';
  } else {
    color = '#ef4444'; // красный
    status = 'Низкая точность GPS, выйдите на открытое место';
  }
  
  gpsQualityIndicator.style.background = color;
  
  if (accuracy > 30) {
    safeStatusUpdate('⚠️ ' + status);
  }
}

// === МАРКЕРЫ СТАРТА И ФИНИША ===

function createStartMarker(lngLat) {
  const el = document.createElement('div');
  el.innerHTML = '🚩';
  el.style.cssText = `
    font-size: 24px;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
  `;
  return new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);
}

function createFinishMarker(lngLat) {
  const el = document.createElement('div');
  el.innerHTML = '🏁';
  el.style.cssText = `
    font-size: 24px;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
  `;
  return new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);
}

// === ЗАГРУЗКА СИСТЕМНОГО МАРШРУТА ===

async function loadPlannedRoute(id) {
  try {
    safeStatusUpdate('Загрузка маршрута...');
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

    let coords, center;
    
    if (plannedRoute.geometry.type === 'LineString') {
      coords = plannedRoute.geometry.coordinates;
      center = coords[Math.floor(coords.length / 2)];
    } else if (plannedRoute.geometry.type === 'Point') {
      const centerPoint = plannedRoute.geometry.coordinates;
      const radius = 0.001;
      coords = [
        [centerPoint[0] - radius, centerPoint[1]],
        [centerPoint[0] - radius, centerPoint[1] + radius],
        [centerPoint[0], centerPoint[1] + radius],
        [centerPoint[0] + radius, centerPoint[1] + radius],
        [centerPoint[0] + radius, centerPoint[1]],
        [centerPoint[0] + radius, centerPoint[1] - radius],
        [centerPoint[0], centerPoint[1] - radius],
        [centerPoint[0] - radius, centerPoint[1] - radius],
        [centerPoint[0] - radius, centerPoint[1]]
      ];
      center = centerPoint;
      plannedRoute.geometry = {
        type: "LineString",
        coordinates: coords
      };
    } else {
      throw new Error('Unsupported geometry type');
    }
    
    // Добавляем маркеры старта и финиша
    if (startMarker) startMarker.remove();
    if (finishMarker) finishMarker.remove();
    
    startMarker = createStartMarker([coords[0][0], coords[0][1]]);
    finishMarker = createFinishMarker([coords[coords.length - 1][0], coords[coords.length - 1][1]]);
    
    // Find nearest point to user
    let nearestPoint = coords[0];
    let minDistance = Infinity;
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        
        for (let i = 0; i < coords.length; i++) {
          const dist = haversineDistance(userLat, userLng, coords[i][1], coords[i][0]);
          if (dist < minDistance) {
            minDistance = dist;
            nearestPoint = coords[i];
          }
        }
        
        plannedStart = nearestPoint;
        setStartMarker([plannedStart[0], plannedStart[1]]);
        
        const mapCenter = [(userLng + plannedStart[0]) / 2, (userLat + plannedStart[1]) / 2];
        map.flyTo({ center: mapCenter, zoom: 14 });
        
        const distanceToStart = Math.round(minDistance);
        safeStatusUpdate(`✅ Маршрут "${plannedRoute.properties.name}" загружен. Ближайшая точка старта в ${distanceToStart}м. Подойдите и нажмите "Старт"`);
        setTimeout(() => {
          if (statusDiv.innerText.includes('загружен')) safeStatusUpdate('');
        }, 4000);
      },
      (err) => {
        console.error('Ошибка получения местоположения:', err);
        plannedStart = coords[0];
        setStartMarker([plannedStart[0], plannedStart[1]]);
        map.flyTo({ center: [center[0], center[1]], zoom: 14 });
        safeStatusUpdate(`✅ Маршрут "${plannedRoute.properties.name}" загружен. Подойдите к точке старта и нажмите "Старт"`);
        setTimeout(() => {
          if (statusDiv.innerText.includes('загружен')) safeStatusUpdate('');
        }, 3000);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
    setTimeout(() => {
      if (statusDiv.innerText.includes('загружен')) safeStatusUpdate('');
    }, 3000);

    getUserLocation();
  } catch (err) {
    console.error(err);
    safeStatusUpdate('❌ Ошибка загрузки маршрута');
  }
}

// === РАСЧЕТ ОСТАВШЕГО РАССТОЯНИЯ ===

function calculateRemainingDistance() {
  if (!plannedRoute || !trackPoints.length) return 0;
  
  const coords = plannedRoute.geometry.coordinates;
  let remainingDistance = 0;
  
  // Находим ближайшую точку на маршруте к текущей позиции
  const currentPos = trackPoints[trackPoints.length - 1];
  let nearestIndex = 0;
  let minDistance = Infinity;
  
  for (let i = 0; i < coords.length; i++) {
    const dist = haversineDistance(currentPos.lat, currentPos.lng, coords[i][1], coords[i][0]);
    if (dist < minDistance) {
      minDistance = dist;
      nearestIndex = i;
    }
  }
  
  // Суммируем расстояние от ближайшей точки до финиша
  for (let i = nearestIndex; i < coords.length - 1; i++) {
    remainingDistance += haversineDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  
  return remainingDistance;
}

// === РАСЧЕТ ТЕКУЩЕГО ТЕМПА ===

function calculateCurrentPace() {
  if (trackPoints.length < 2) return 0;
  
  const recentPoints = trackPoints.slice(-CURRENT_PACE_POINTS);
  if (recentPoints.length < 2) return 0;
  
  let totalDistance = 0;
  let totalTime = 0;
  
  for (let i = 1; i < recentPoints.length; i++) {
    const dist = haversineDistance(
      recentPoints[i-1].lat, recentPoints[i-1].lng,
      recentPoints[i].lat, recentPoints[i].lng
    );
    const time = recentPoints[i].timestamp - recentPoints[i-1].timestamp;
    
    totalDistance += dist;
    totalTime += time;
  }
  
  if (totalDistance === 0 || totalTime === 0) return 0;
  
  // темп в секундах на километр
  const paceSecPerKm = (totalTime / 1000) / (totalDistance / 1000);
  return paceSecPerKm;
}

// === ОБНОВЛЕНИЕ ПРОГРЕССА МАРШРУТА ===

function updateRouteProgress(lat, lng) {
  if (!plannedRoute || !routeProgress.isOnRoute) return;
  
  const coords = plannedRoute.geometry.coordinates;
  
  // Находим ближайший сегмент к текущей позиции
  let minDistance = Infinity;
  let closestSegment = 0;
  
  for (let i = 0; i < coords.length - 1; i++) {
    const dist = haversineDistance(lat, lng, coords[i][1], coords[i][0]);
    if (dist < minDistance) {
      minDistance = dist;
      closestSegment = i;
    }
  }
  
  // Обновляем пройденную часть маршрута
  const completedCoords = coords.slice(0, closestSegment + 1);
  
  if (map.getSource('completed-route')) {
    map.getSource('completed-route').setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: completedCoords
        },
        properties: {}
      }]
    });
  }
  
  routeProgress.currentIndex = closestSegment;
  routeProgress.completedSegments = closestSegment;
  routeProgress.lastProgressUpdate = Date.now();
}

// === ОБНОВЛЕНИЕ UI С УЛУЧШЕНИЯМИ ===

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

  // Средний темп
  let avgPace = 0;
  if (totalDistanceM > 0 && elapsedSec > 0) {
    avgPace = (elapsedSec / 60) / (totalDistanceM / 1000);
  }
  const avgPaceMin = Math.floor(avgPace);
  const avgPaceSec = Math.floor((avgPace - avgPaceMin) * 60);
  paceEl.textContent = `${avgPaceMin}'${avgPaceSec.toString().padStart(2, '0')}"`;

  // Текущий темп
  const currentPace = calculateCurrentPace();
  if (currentPaceEl && currentPace > 0) {
    const curMin = Math.floor(currentPace);
    const curSec = Math.floor((currentPace - curMin) * 60);
    currentPaceEl.textContent = `Темп сейчас: ${curMin}'${curSec.toString().padStart(2, '0')}"`;
  }

  // Оставшееся расстояние
  if (remainingDistanceEl && sessionMode === 'planned_route') {
    const remainingM = calculateRemainingDistance();
    remainingDistanceEl.textContent = `Осталось: ${(remainingM / 1000).toFixed(2)} км`;
  }
}

// === БЕЗОПАСНЫЕ ФУНКЦИИ ===

function safeMapOperation(operation) {
  if (!map || !map.loaded()) {
    console.warn('Map not ready for operation');
    return false;
  }
  return true;
}

function safeStatusUpdate(message) {
  if (statusDiv) {
    statusDiv.innerText = message;
  } else {
    console.log('Status update:', message);
  }
}

// === ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) ===

function initializeRouteProgress() {
  if (!plannedRoute || !plannedRoute.geometry) return;
  
  const coords = plannedRoute.geometry.coordinates;
  routeProgress.currentIndex = 0;
  routeProgress.completedSegments = 0;
  routeProgress.totalSegments = coords.length - 1;
  routeProgress.isOnRoute = true;
  routeProgress.lastProgressUpdate = Date.now();
  
  console.log('Route progress initialized:', routeProgress);
}

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

// [Остальной код остается таким же, как в оригинале...]

console.log('Enhanced app initialized with all improvements');
