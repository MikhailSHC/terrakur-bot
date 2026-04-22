const RouteService = require('../services/routeService');

describe('RouteService', () => {
  let routeService;

  beforeEach(() => {
    routeService = new RouteService();
  });

  it('returns active route by id for API with location meta', () => {
    const route = routeService.getRouteByIdForApi('tamanskiy-les');

    expect(route).toBeTruthy();
    expect(route.id).toBe('tamanskiy-les');
    expect(route.location).toBeTruthy();
    expect(route.location.id).toBe('stavropol');
  });

  it('sorts routes by distance and applies limit filter', () => {
    const nearest = routeService.getRoutesSortedByDistance(45.04, 41.97, {
      activityId: 'nordic_walking',
      limit: 3
    });

    expect(nearest).toHaveLength(3);
    expect(nearest[0].distanceKm).toBeLessThanOrEqual(nearest[1].distanceKm);
    expect(nearest[1].distanceKm).toBeLessThanOrEqual(nearest[2].distanceKm);
  });
});
