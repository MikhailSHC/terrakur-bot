// public/mini-app/app.js

const params = new URLSearchParams(window.location.search);
const routeId = params.get('routeId');
const chatId = params.get('chatId');

const routeEl = document.getElementById('route');
const userEl = document.getElementById('user');
const statusEl = document.getElementById('status');

let userMarker = null;
let watchId = null;

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#444';
}

function setTextInfo() {
  if (!routeId) {
    routeEl.textContent = 'Маршрут не указан (routeId отсутствует в URL).';
  } else {
    routeEl.textContent = `Маршрут: ${routeId}`;
  }

  if (!chatId) {
    userEl.textContent = 'Пользователь не указан (chatId отсутствует в URL).';
  } else {
    userEl.textContent = `Пользователь (chatId): ${chatId}`;
  }
}

async function loadRoute(routeId) {
  const response = await fetch(`/api/routes/${encodeURIComponent(routeId)}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok || !data.route) {
    throw new Error(data.error || 'Route data is invalid');
  }

  return data.route;
}

function initMap(center, zoom = 15) {
  const map = L.map('map').setView(center, zoom);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  return map;
}

function drawRoute(map, track) {
  if (!track || !Array.isArray(track) || track.length === 0) {
    console.warn('Нет точек трека для отрисовки');
    return null;
  }

  const polyline = L.polyline(track, {
    color: 'blue',
    weight: 5
  }).addTo(map);

  map.fitBounds(polyline.getBounds());

  return polyline;
}

function setupStartButton(map) {
  const btn = document.getElementById('start-route-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Геолокация не поддерживается на этом устройстве');
      return;
    }

    if (watchId !== null) {
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 10000
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => updateUserLocation(map, pos),
      (err) => {
        console.error('Geolocation error', err);
        alert(`Ошибка геолокации (code ${err.code}): ${err.message}`);
      },
      options
    );
  });
}

function updateUserLocation(map, pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  if (!userMarker) {
    userMarker = L.marker([lat, lng], {
      title: 'Вы здесь'
    }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lng]);
  }

  map.setView([lat, lng], map.getZoom(), { animate: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  setTextInfo();

  if (!routeId) {
    setStatus('routeId отсутствует в URL.', true);
    const map = initMap([43.907, 42.716], 13);
    setupStartButton(map);
    return;
  }

  setStatus('Загрузка маршрута...');

  try {
    const route = await loadRoute(routeId);

    const routeName = route?.name || routeId;
    routeEl.textContent = `Маршрут: ${routeName}`;

    const defaultCenter =
      (route.track && route.track.length > 0 && route.track[0]) ||
      (route.center && typeof route.center.lat === 'number' && typeof route.center.lon === 'number'
        ? [route.center.lat, route.center.lon]
        : [43.907, 42.716]);

    const map = initMap(defaultCenter);

    if (route.track && route.track.length > 0) {
      drawRoute(map, route.track);
      setStatus('Маршрут загружен.');
    } else {
      L.marker(defaultCenter, { title: routeName }).addTo(map);
      setStatus('Маршрут загружен, но трек пока не заполнен.');
    }

    setupStartButton(map);
  } catch (error) {
    console.error('Ошибка загрузки маршрута:', error);

    const map = initMap([43.907, 42.716], 13);
    setupStartButton(map);

    setStatus(`Не удалось загрузить маршрут: ${error.message}`, true);
  }
});