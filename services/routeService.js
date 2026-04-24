// Сервис работы с маршрутами

const routes = require('../data/routesData');
const LOCATIONS = require('../data/locationsData');
const ACTIVITIES = require('../data/activitiesData');

class RouteService {
  // Локации
  getLocationById(id) {
    return LOCATIONS.find(l => l.id === id);
  }

  // Активности
  getActivityById(id) {
    return ACTIVITIES.find(a => a.id === id);
  }

  // Маршруты по локации и активности
  getRoutesForLocationAndActivity(locationId, activityId) {
    return routes.filter(route =>
      route.locationId === locationId &&
      route.activities.includes(activityId) &&
      route.status === 'active'
    );
  }

  // Поиск конкретного маршрута по id
  findRouteById(routeId) {
    return routes.find(route => route.id === routeId && route.status === 'active') || null;
  }

  // Расстояние в км между двумя точками (формула гаверсинусов)
  getDistanceKm(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
    const toRad = deg => (Math.PI / 180) * deg;
    const R = 6371;

    const lat1 = toRad(lat1Deg);
    const lon1 = toRad(lon1Deg);
    const lat2 = toRad(lat2Deg);
    const lon2 = toRad(lon2Deg);

    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  getRouteCenter(route) {
    if (route?.center && typeof route.center.lat === 'number' && typeof route.center.lon === 'number') {
      return {
        lat: route.center.lat,
        lon: route.center.lon
      };
    }

    if (!Array.isArray(route?.track) || route.track.length === 0) {
      return null;
    }

    const valid = route.track.filter(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(Number(point[0])) &&
        Number.isFinite(Number(point[1]))
    );
    if (!valid.length) return null;

    // Резервный центр из геометрии трека (средняя точка), чтобы корректно работал рейтинг "рядом".
    const mid = valid[Math.floor(valid.length / 2)];
    return {
      lat: Number(mid[0]),
      lon: Number(mid[1])
    };
  }

  /**
   * Все маршруты, отсортированные по расстоянию до пользователя.
   * userLat, userLon — координаты пользователя.
   * options: { activityId?: string, limit?: number }
   */
  getRoutesSortedByDistance(userLat, userLon, options = {}) {
    const { activityId, limit } = options;
    const routesWithDistance = [];

    for (const route of routes) {
      if (route.status !== 'active') continue;
      if (activityId && !route.activities.includes(activityId)) continue;
      const center = this.getRouteCenter(route);
      if (!center) continue;

      const distanceKm = this.getDistanceKm(
        userLat,
        userLon,
        center.lat,
        center.lon
      );

      const location = this.getLocationById(route.locationId);

      routesWithDistance.push({
        location,
        route,
        distanceKm
      });
    }

    routesWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);

    if (limit && routesWithDistance.length > limit) {
      return routesWithDistance.slice(0, limit);
    }

    return routesWithDistance;
  }

  // Для будущего API: получить маршрут с локацией в одном объекте
  getRouteByIdForApi(routeId) {
    const route = this.findRouteById(routeId);
    if (!route) return null;

    const location = this.getLocationById(route.locationId);

    return {
      ...route,
      location: location
        ? {
            id: location.id,
            name: location.name,
            emoji: location.emoji
          }
        : null
    };
  }
}

module.exports = RouteService;