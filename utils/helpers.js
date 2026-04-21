// utils/helpers.js

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
      const distance = route.distance;   // '3-5 km'
      const duration = route.duration;   // '1-2 hours'
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

  if (locationName) {
    lines.push(`📍 Локация: ${locationName}`);
  }

  if (activityName) {
    lines.push(`🏃 Активность: ${activityName}`);
  }

  if (route.distance) {
    lines.push(`📏 Дистанция: ${route.distance}`);
  }

  if (route.duration) {
    lines.push(`⏱ Время: ${route.duration}`);
  }

  if (route.difficulty !== undefined) {
    lines.push(`⭐️ Сложность: ${difficultyLabel(route.difficulty)}`);
  }

  if (Array.isArray(route.target_audience) && route.target_audience.length > 0) {
    lines.push(`👥 Для кого: ${route.target_audience.join(', ')}`);
  }

  if (Array.isArray(route.points) && route.points.length > 0) {
    lines.push('');
    lines.push('📌 Основные точки маршрута:');
    route.points.forEach((p, idx) => {
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