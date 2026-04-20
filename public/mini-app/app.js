// app.js – TerraKur беговой трекер с фильтрацией GPS (кнопка "Старт")
let map, userMarker, watchId = null;
let isTracking = false, isPaused = false;
let trackPoints = [];
let startTime = null, pausedDuration = 0, pauseStart = null;
let plannedRoute = null;
let lastSavedPoint = null;

const MIN_DISTANCE_METERS = 5;
const MIN_TIME_MS = 2000;
const MAX_JUMP_METERS = 50;

const statsPanel = document.getElementById('statsPanel');
const timeEl = document.getElementById('time');
const distanceEl = document.getElementById('distance');
const paceEl = document.getElementById('pace');
const statusDiv = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const routesBtn = document.getElementById('routesBtn');
const historyBtn = document.getElementById('historyBtn');

const urlParams = new URLSearchParams(window.location.search);
const routeId = urlParams.get('routeId');
const chatId = urlParams.get('chatId') || 'test_user';

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    },
    center: [42.7165, 43.9071], zoom: 13
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.on('load', () => {
    map.addSource('run-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'run-line', type: 'line', source: 'run-track', paint: { 'line-color': '#ff4d4d', 'line-width': 5 } });
    if (routeId) loadPlannedRoute(routeId);
    else getUserLocation();
  });
}

async function loadPlannedRoute(id) {
  try {
    statusDiv.innerText = 'Загрузка маршрута...';
    const res = await fetch(`/api/routes/${id}/geojson`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    plannedRoute = data.route;
    if (!map.getSource('planned-route')) {
      map.addSource('planned-route', { type: 'geojson', data: plannedRoute });
      map.addLayer({ id: 'planned-route-line', type: 'line', source: 'planned-route', paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-dasharray': [2,2] } });
    }
    const coords = plannedRoute.geometry.coordinates;
    const center = coords[Math.floor(coords.length / 2)];
    map.flyTo({ center: [center[0], center[1]], zoom: 14 });
    statusDiv.innerText = `✅ Маршрут "${plannedRoute.properties.name}" загружен. Нажмите "Старт"`;
    setTimeout(() => { if (statusDiv.innerText.includes('загружен')) statusDiv.innerText = ''; }, 3000);
    getUserLocation();
  } catch (err) { statusDiv.innerText = '❌ Ошибка загрузки маршрута'; }
}

function getUserLocation() {
  if (!navigator.geolocation) { statusDiv.innerText = '❌ Геолокация не поддерживается'; return; }
  statusDiv.innerText = '📍 Запрос местоположения...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      addUserMarker([longitude, latitude]);
      map.flyTo({ center: [longitude, latitude], zoom: 15 });
      statusDiv.innerText = '✅ Готов к тренировке';
      setTimeout(() => { if (statusDiv.innerText === '✅ Готов к тренировке') statusDiv.innerText = ''; }, 2000);
    },
    () => statusDiv.innerText = '❌ Нет доступа к геолокации',
    { enableHighAccuracy: true }
  );
}

function addUserMarker(lngLat) {
  if (userMarker) userMarker.remove();
  const el = document.createElement('div');
  el.style.cssText = 'width:24px;height:24px;background:#2ecc71;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5);';
  userMarker = new maplibregl.Marker(el).setLngLat(lngLat).addTo(map);
}

function updateUserMarker(lngLat) {
  userMarker ? userMarker.setLngLat(lngLat) : addUserMarker(lngLat);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1), Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function shouldSavePoint(lat, lng, now) {
  if (!lastSavedPoint) return true;
  const dist = haversineDistance(lastSavedPoint.lat, lastSavedPoint.lng, lat, lng);
  const timeDiff = now - lastSavedPoint.timestamp;
  if (dist > MAX_JUMP_METERS && timeDiff < MIN_TIME_MS) {
    console.warn(`Выброс GPS: ${dist.toFixed(1)} м за ${timeDiff} мс`);
    return false;
  }
  return (dist >= MIN_DISTANCE_METERS || timeDiff >= MIN_TIME_MS);
}

function addFilteredPoint(lat, lng, timestamp) {
  if (!shouldSavePoint(lat, lng, timestamp)) return false;
  const point = { lat, lng, timestamp };
  trackPoints.push(point);
  lastSavedPoint = point;
  redrawTrack();
  updateStatsUI();
  return true;
}

function updateStatsUI() {
  if (!startTime || isPaused || !isTracking) return;
  const now = Date.now();
  let elapsedSec = Math.max(0, (now - startTime - pausedDuration) / 1000);
  const minutes = Math.floor(elapsedSec / 60), seconds = Math.floor(elapsedSec % 60);
  timeEl.textContent = `${minutes}:${seconds.toString().padStart(2,'0')}`;
  let totalDistance = 0;
  for (let i = 1; i < trackPoints.length; i++) {
    totalDistance += haversineDistance(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
  }
  const distanceKm = totalDistance / 1000;
  distanceEl.textContent = distanceKm.toFixed(2);
  let pace = 0;
  if (totalDistance > 0 && elapsedSec > 0) pace = (elapsedSec / 60) / (totalDistance / 1000);
  const paceMin = Math.floor(pace), paceSec = Math.floor((pace - paceMin) * 60);
  paceEl.textContent = `${paceMin}'${paceSec.toString().padStart(2,'0')}"`;
}

function redrawTrack() {
  if (!map.getSource('run-track')) return;
  map.getSource('run-track').setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: trackPoints.map(p => [p.lng, p.lat]) }, properties: {} }]
  });
}

function getSmoothedPosition() {
  if (trackPoints.length === 0) return null;
  const len = trackPoints.length;
  const count = Math.min(3, len);
  let sumLat = 0, sumLng = 0;
  for (let i = len - count; i < len; i++) {
    sumLat += trackPoints[i].lat;
    sumLng += trackPoints[i].lng;
  }
  return { lat: sumLat / count, lng: sumLng / count };
}

function onGPSPosition(pos) {
  if (!isTracking || isPaused) return;
  const { latitude, longitude } = pos.coords;
  const now = Date.now();
  addFilteredPoint(latitude, longitude, now);
  const smoothed = getSmoothedPosition();
  if (smoothed) updateUserMarker([smoothed.lng, smoothed.lat]);
  else updateUserMarker([longitude, latitude]);
  if (smoothed) map.flyTo({ center: [smoothed.lng, smoothed.lat], zoom: 16, duration: 500 });
  else map.flyTo({ center: [longitude, latitude], zoom: 16, duration: 500 });
}

function startRun() {
  if (isTracking) return;
  if (!navigator.geolocation) { statusDiv.innerText = '❌ Геолокация недоступна'; return; }
  isTracking = true; isPaused = false;
  trackPoints = []; lastSavedPoint = null;
  startTime = Date.now(); pausedDuration = 0; pauseStart = null;
  statsPanel.classList.remove('hidden');
  startBtn.textContent = '⏸ Пауза';
  routesBtn.disabled = historyBtn.disabled = true;
  statusDiv.innerText = '🏃 Тренировка началась...';
  redrawTrack();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onGPSPosition, err => console.error(err), { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 });
}

function pauseResume() {
  if (!isTracking) return;
  if (isPaused) {
    isPaused = false;
    if (pauseStart) pausedDuration += Date.now() - pauseStart;
    pauseStart = null;
    startBtn.textContent = '⏸ Пауза';
    statusDiv.innerText = '▶️ Продолжаем...';
    setTimeout(() => { if (statusDiv.innerText === '▶️ Продолжаем...') statusDiv.innerText = ''; }, 1500);
    if (watchId === null) watchId = navigator.geolocation.watchPosition(onGPSPosition, err => console.error(err), { enableHighAccuracy: true });
  } else {
    isPaused = true;
    pauseStart = Date.now();
    startBtn.textContent = '▶️ Старт';
    statusDiv.innerText = '⏸ Тренировка на паузе';
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }
}

async function stopAndSave() {
  if (!isTracking) return;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  isTracking = false; isPaused = false;
  const endTime = Date.now();
  let elapsedSec = Math.max(0, (endTime - startTime - pausedDuration) / 1000);
  let totalDistance = 0;
  for (let i = 1; i < trackPoints.length; i++) totalDistance += haversineDistance(trackPoints[i-1].lat, trackPoints[i-1].lng, trackPoints[i].lat, trackPoints[i].lng);
  const distanceM = totalDistance;
  const avgPaceSecPerKm = distanceM > 0 ? (elapsedSec / (distanceM / 1000)) : 0;
  const geojsonTrack = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: trackPoints.map(p => [p.lng, p.lat]) }, properties: {} }] };
  const session = { startedAt: new Date(startTime).toISOString(), finishedAt: new Date(endTime).toISOString(), durationSec: elapsedSec, distanceM, avgPaceSecPerKm, geojson: geojsonTrack, mode: plannedRoute ? 'planned_route' : 'free_run' };
  if (plannedRoute) session.plannedRouteId = plannedRoute.properties.id;
  try {
    const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, session }) });
    const data = await res.json();
    statusDiv.innerText = data.ok ? '✅ Тренировка сохранена!' : '⚠️ Ошибка сохранения';
  } catch (err) { statusDiv.innerText = '❌ Не удалось сохранить'; }
  statsPanel.classList.add('hidden');
  startBtn.textContent = '▶️ Старт';
  routesBtn.disabled = historyBtn.disabled = false;
  setTimeout(() => { if (statusDiv.innerText !== '✅ Тренировка сохранена!') statusDiv.innerText = ''; }, 3000);
  const stopBtn = document.getElementById('dynamicStopBtn');
  if (stopBtn) stopBtn.remove();
}

startBtn.onclick = () => isTracking ? pauseResume() : startRun();
routesBtn.onclick = () => statusDiv.innerText = 'Выберите маршрут в боте';
historyBtn.onclick = () => statusDiv.innerText = 'История тренировок (скоро)';

function showStopButton() {
  if (document.getElementById('dynamicStopBtn')) return;
  const stopBtn = document.createElement('button');
  stopBtn.id = 'dynamicStopBtn';
  stopBtn.textContent = '⏹️ Стоп';
  stopBtn.style.cssText = 'position:fixed;bottom:100px;right:16px;z-index:3;background:#e74c3c;';
  document.body.appendChild(stopBtn);
  stopBtn.onclick = () => { stopAndSave(); stopBtn.remove(); };
}

const originalStartRun = startRun;
startRun = function() { originalStartRun(); showStopButton(); };

initMap();