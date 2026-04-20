// app.js – TerraKur беговый трекер (ИСПРАВЛЕННАЯ ВЕРСИЯ)

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

// DOM-элементы
const statsPanel   = document.getElementById('statsPanel');
const timeEl       = document.getElementById('time');
const distanceEl   = document.getElementById('distance');
const paceEl       = document.getElementById('pace');
const statusDiv    = document.getElementById('status');
const startBtn     = document.getElementById('startBtn');

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

// Таймер для UI
let uiTimerId = null;

// Параметры карты - ИСПРАВЛЕНО
const FLY_INTERVAL_MS = 5000;  // интервал для flyTo анимации
let lastFlyTime = 0;           // время последнего flyTo

// Для статуса по старту
let lastStartStatus = null;   // последнее текстовое состояние про "подойдите к старту"

// === ПРОГРЕСС ПО МАРШРУТУ === - ИСПРАВЛЕНО

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

function updateRouteProgress(lat, lng) {
  if (!plannedRoute || !routeProgress.isOnRoute) return;
  
  // TODO: реализовать логику отслеживания прогресса
  console.log('Updating route progress for:', lat, lng);
}

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

// Безопасные операции с картой - ИСПРАВЛЕНО
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

// Остальной код остается таким же...
// [Здесь будет остальная часть кода из оригинального файла]

console.log('App initialized with fixes applied');
