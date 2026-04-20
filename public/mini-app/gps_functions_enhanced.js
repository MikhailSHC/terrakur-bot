// УЛУЧШЕННЫЕ GPS ФУНКЦИИ ДЛЯ app_enhanced.js

// === ОБНОВЛЕННЫЙ ОБРАБОТЧИК GPS ===

function onGPSEnhanced(pos) {
  if (!isTracking || isPaused) return;

  const { latitude, longitude, accuracy } = pos.coords;
  const now = Date.now();

  // Обновляем индикатор качества GPS
  updateGPSQualityIndicator(accuracy);

  const accepted = addFilteredPoint(latitude, longitude, now, accuracy);

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
      initializeRouteProgress();
      safeStatusUpdate('✅ Вы в зоне старта маршрута, можно начинать');
      setTimeout(() => {
        if (statusDiv.innerText.includes('зоне старта')) {
          safeStatusUpdate('');
        }
      }, 3000);
    } else {
      const rounded = Math.round(distToStart / 5) * 5;
      const msg = `🏁 Подойдите к точке старта (≈ ${rounded} м)`;
      if (msg !== lastStartStatus) {
        lastStartStatus = msg;
        safeStatusUpdate(msg);
      }
    }
  }

  // Плавная анимация карты с проверкой
  if (safeMapOperation()) {
    if (now - lastFlyTime > FLY_INTERVAL_MS) {
      map.flyTo({ center, zoom: 16, duration: 500 });
      lastFlyTime = now;
    } else {
      map.jumpTo({ center, zoom: 16 });
    }
  }
}

// === УЛУЧШЕННАЯ ФУНКЦИЯ ДОБАВЛЕНИЯ ТОЧЕК ===

function addFilteredPointEnhanced(lat, lng, timestamp, accuracy) {
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

  redrawTrackEnhanced();
  return true;
}

// === УЛУЧШЕННАЯ ФУНКЦИЯ ПЕРЕРИСОВКИ ТРЕКА ===

function redrawTrackEnhanced() {
  if (!safeMapOperation()) return;

  const coordinates = trackPoints.map(p => [p.lng, p.lat]);

  // Обновляем записанный трек (красный)
  if (map.getSource('run-track')) {
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

  // Обновляем пройденную часть маршрута (зеленый)
  if (sessionMode === 'planned_route' && plannedRoute && trackPoints.length > 0) {
    updateRouteProgress(coordinates[coordinates.length - 1][1], coordinates[coordinates.length - 1][0]);
  }
}

// === УЛУЧШЕННЫЙ ЗАПУСК ТРЕНИРОВКИ ===

function startRunEnhanced() {
  if (isTracking && !isPaused) return;

  if (!navigator.geolocation) {
    safeStatusUpdate('❌ Геолокация недоступна');
    return;
  }

  // Для готового маршрута: требуем дойти до старта
  if (sessionMode === 'planned_route' && plannedRoute && plannedStart && !hasReachedStart) {
    safeStatusUpdate('🏁 Сначала подойдите к точке старта маршрута (синяя линия на карте)');
    return;
  }

  if (!isTracking) {
    // Первый запуск тренировки
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

    safeStatusUpdate('🏃 Тренировка началась...');

    redrawTrackEnhanced();

    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      onGPSEnhanced,
      (err) => {
        console.error(err);
        if (err.code === 3) {
          safeStatusUpdate('⚠️ Потеряна связь со спутниками, ищу сигнал...');
        }
      },
      { 
        enableHighAccuracy: true, 
        maximumAge: 1000, 
        timeout: 5000 
      }
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
    safeStatusUpdate('▶️ Продолжаем...');
    setTimeout(() => {
      if (statusDiv.innerText === '▶️ Продолжаем...') safeStatusUpdate('');
    }, 1500);

    if (watchId === null) {
      watchId = navigator.geolocation.watchPosition(
        onGPSEnhanced,
        (err) => console.error(err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    }
  }
}

// === ИНТЕГРАЦИЯ С ОСНОВНЫМ ФАЙЛОМ ===

// Для интеграции с app_enhanced.js нужно заменить следующие функции:
// - onGPSPosition -> onGPSEnhanced
// - addFilteredPoint -> addFilteredPointEnhanced  
// - redrawTrack -> redrawTrackEnhanced
// - startRun -> startRunEnhanced

console.log('Enhanced GPS functions loaded');
