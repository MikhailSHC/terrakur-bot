const request = require('supertest');
const { createApp } = require('../app/createApp');
const { createMiniAppAuthMiddleware } = require('../middleware/miniAppAuth');
const { createMiniAppToken } = require('../utils/miniAppAuth');

function createDeps(configOverrides = {}) {
  return {
    userService: {
      addSession: jest.fn(),
      addRouteToHistory: jest.fn(),
      getSessions: jest.fn(() => []),
      getLifetimeStats: jest.fn(() => ({
        totalDistanceM: 0,
        totalDurationSec: 0,
        totalSessions: 0
      }))
    },
    routeService: {
      findRouteById: jest.fn(() => null),
      getRouteByIdForApi: jest.fn(() => null)
    },
    miniAppAuth: createMiniAppAuthMiddleware('test-secret'),
    config: {
      DGIS_API_KEY: '',
      ...configOverrides
    }
  };
}

describe('Runtime config and custom route API', () => {
  it('returns runtime config via /api/runtime-config', async () => {
    const app = createApp(createDeps({ DGIS_API_KEY: 'demo-key' }));
    const response = await request(app).get('/api/runtime-config');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.DGIS_API_KEY).toBe('demo-key');
  });

  it('blocks /api/routes/build-custom without auth token', async () => {
    const app = createApp(createDeps());
    const response = await request(app).post('/api/routes/build-custom').send({
      chatId: '42',
      provider: '2gis',
      waypoints: [
        { lon: 41.9, lat: 45.0 },
        { lon: 41.91, lat: 45.01 }
      ]
    });
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  it('builds custom route with auth and returns geojson', async () => {
    const app = createApp(createDeps());
    const token = createMiniAppToken('42', 'test-secret', Date.now());
    const response = await request(app)
      .post('/api/routes/build-custom')
      .set('x-miniapp-auth', token)
      .send({
        chatId: '42',
        provider: '2gis',
        waypoints: [
          { lon: 41.9, lat: 45.0 },
          { lon: 41.91, lat: 45.01 }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.provider).toBe('2gis');
    expect(response.body.geojson?.features?.[0]?.geometry?.type).toBe('LineString');
  });

  it('returns 503 for geocode without configured dgis key', async () => {
    const app = createApp(createDeps({ DGIS_API_KEY: '' }));
    const response = await request(app).get('/api/geocode?q=test');
    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
  });
});
