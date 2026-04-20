// Исправления для критических ошибок в app.js

// 1. Добавить эти переменные после строки 71:
const FLY_INTERVAL_MS = 5000;  // интервал для flyTo анимации
let lastFlyTime = 0;           // время последнего flyTo

// 2. Добавить эту функцию где-нибудь в файле:
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

// 3. Добавить проверки на null в функциях:
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
