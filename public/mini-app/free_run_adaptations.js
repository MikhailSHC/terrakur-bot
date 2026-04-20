// АДАПТАЦИИ ДЛЯ РЕЖИМА СВОБОДНОГО БЕГА

// === МОДИФИЦИРОВАННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ UI ===

function updateStatsUIFreeRun() {
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

  // Текущий темп - работает для всех режимов
  const currentPace = calculateCurrentPace();
  if (currentPaceEl && currentPace > 0) {
    const curMin = Math.floor(currentPace);
    const curSec = Math.floor((currentPace - curMin) * 60);
    currentPaceEl.textContent = `Темп сейчас: ${curMin}'${curSec.toString().padStart(2, '0')}"`;
  }

  // Для свободного бега - показываем дополнительную статистику вместо оставшегося расстояния
  if (remainingDistanceEl) {
    if (sessionMode === 'free_run') {
      // Показываем прогнозируемое расстояние на основе текущего темпа
      const avgSpeedMs = totalDistanceM / elapsedSec; // средняя скорость в м/с
      if (avgSpeedMs > 0) {
        const projectedHourlyDistance = avgSpeedMs * 3600 / 1000; // км в час
        remainingDistanceEl.textContent = `Прогноз: ${projectedHourlyDistance.toFixed(1)} км/ч`;
      } else {
        remainingDistanceEl.textContent = 'Прогноз: -- км/ч';
      }
    } else {
      // Для готовых маршрутов - оставшееся расстояние
      const remainingM = calculateRemainingDistance();
      remainingDistanceEl.textContent = `Осталось: ${(remainingM / 1000).toFixed(2)} км`;
    }
  }
}

// === АДАПТАЦИЯ ВИЗУАЛИЗАЦИИ ДЛЯ СВОБОДНОГО БЕГА ===

function redrawTrackFreeRun() {
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

  // Для свободного бега - не показываем пройденную часть (нет маршрута)
  if (map.getSource('completed-route')) {
    map.getSource('completed-route').setData({
      type: 'FeatureCollection',
      features: []
    });
  }
}

// === АДАПТАЦИЯ МАРКЕРОВ ДЛЯ СВОБОДНОГО БЕГА ===

function addFreeRunMarkers() {
  // Удаляем маркеры старта/финиша для свободного бега
  if (startMarker) {
    startMarker.remove();
    startMarker = null;
  }
  if (finishMarker) {
    finishMarker.remove();
    finishMarker = null;
  }
  
  // Добавляем маркер текущей позиции как "виртуальный старт"
  if (trackPoints.length > 0) {
    const firstPoint = trackPoints[0];
    const el = document.createElement('div');
    el.innerHTML = '🏃';
    el.style.cssText = `
      font-size: 20px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    `;
    startMarker = new maplibregl.Marker(el).setLngLat([firstPoint.lng, firstPoint.lat]).addTo(map);
  }
}

// === УЛУЧШЕННЫЙ ЗАПУСК ДЛЯ СВОБОДНОГО БЕГА ===

function startRunFreeRun() {
  if (isTracking && !isPaused) return;

  if (!navigator.geolocation) {
    safeStatusUpdate('❌ Геолокация недоступна');
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

    if (sessionMode === 'free_run') {
      safeStatusUpdate('🏃 Свободный бег начался...');
      addFreeRunMarkers();
    } else {
      safeStatusUpdate('🏃 Тренировка началась...');
    }

    redrawTrackFreeRun();

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
        if (isTracking && !isPaused) updateStatsUIFreeRun();
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

// === ИНТЕГРАЦИЯ АДАПТАЦИЙ ===

// Для использования в app_enhanced.js:
// 1. Заменить updateStatsUI() на updateStatsUIFreeRun()
// 2. Заменить redrawTrack() на redrawTrackFreeRun()
// 3. Заменить startRun() на startRunFreeRun()
// 4. Вызвать addFreeRunMarkers() при старте свободного бега

console.log('Free run adaptations loaded');
