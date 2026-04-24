// Вспомогательные функции форматирования

function difficultyLabel(level) {
  if (level === 1) return 'легкий';
  if (level === 2) return 'средний';
  if (level === 3) return 'сложный';
  return String(level);
}

// Краткий список маршрутов
function formatRouteList(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    return 'Маршруты не найдены.';
  }

  return routes
    .map((route, index) => {
      const num = index + 1;
      const name = route.name || `Маршрут ${num}`;
      const distance = route.distance || route.distanceText || (route.distanceKm ? `${route.distanceKm} км` : null);
      const duration = route.duration;   // например: '1-2 часа'
      const difficulty = route.difficulty;

      let line = `${num}. ${name}`;

      if (distance) {
        line += ` — ${distance}`;
      }

      if (duration) {
        line += `, ${duration}`;
      }

      if (difficulty !== undefined) {
        line += ` (сложность: ${difficultyLabel(difficulty)})`;
      }

      return line;
    })
    .join('\n');
}

// Детали маршрута
function formatRouteDetails(route, options = {}) {
  if (!route || typeof route !== 'object') {
    return 'Маршрут не найден.';
  }

  const { locationName, activityName } = options;
  const lines = [];

  const name = route.name || 'Маршрут';
  lines.push(name);
  lines.push('');

  if (locationName) {
    lines.push(`Локация: ${locationName}`);
  }

  if (activityName) {
    lines.push(`Активность: ${activityName}`);
  }

  const distance = route.distance || route.distanceText || (route.distanceKm ? `${route.distanceKm} км` : null);
  if (distance) {
    lines.push(`Дистанция: ${distance}`);
  }

  if (route.duration) {
    lines.push(`Время: ${route.duration}`);
  }

  if (route.difficulty !== undefined) {
    lines.push(`Сложность: ${difficultyLabel(route.difficulty)}`);
  }

  const targetAudience = Array.isArray(route.targetAudience) ? route.targetAudience : route.target_audience;
  if (Array.isArray(targetAudience) && targetAudience.length > 0) {
    lines.push(`Для кого: ${targetAudience.join(', ')}`);
  }

  const poi = Array.isArray(route.poi) ? route.poi : route.points;
  if (Array.isArray(poi) && poi.length > 0) {
    lines.push('');
    lines.push('Основные точки маршрута:');
    poi.forEach((p, idx) => {
      lines.push(`  ${idx + 1}. ${p}`);
    });
  }

  if (route.description) {
    lines.push('');
    lines.push(route.description);
  }

  return lines.join('\n');
}

module.exports = {
  formatRouteList,
  formatRouteDetails
};