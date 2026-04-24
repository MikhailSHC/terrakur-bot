const RouteService = require('../services/routeService');

describe('RouteService', () => {
  let routeService;

  beforeEach(() => {
    routeService = new RouteService();
  });

  it('returns active route by id for API with location meta', () => {
    const route = routeService.getRouteByIdForApi('kholodnye-rodniki');

    expect(route).toBeTruthy();
    expect(route.id).toBe('kholodnye-rodniki');
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

  it('uses updated 2GIS geometry for kholodnye-rodniki', () => {
    const route = routeService.findRouteById('kholodnye-rodniki');
    expect(route).toBeTruthy();
    expect(route.distanceKm).toBe(4.5);
    expect(route.duration).toBe('50-70 мин');
    expect(Array.isArray(route.track)).toBe(true);
    expect(route.track.length).toBeGreaterThan(80);
    expect(route.track[0]).toEqual([45.039871, 41.935354]);
    expect(route.track[route.track.length - 1]).toEqual([45.051289, 41.95711]);
  });
});
