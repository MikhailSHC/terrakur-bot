const request = require('supertest');
const { createApp } = require('../app/createApp');
const { createMiniAppAuthMiddleware } = require('../middleware/miniAppAuth');
const { createMiniAppToken } = require('../utils/miniAppAuth');

function createMockDeps() {
  const sessionsByChatId = new Map();

  return {
    userService: {
      addSession: jest.fn((chatId, session) => {
        const existing = sessionsByChatId.get(chatId) || [];
        sessionsByChatId.set(chatId, [...existing, session]);
      }),
      addRouteToHistory: jest.fn(),
      getSessions: jest.fn((chatId) => sessionsByChatId.get(chatId) || [])
    },
    routeService: {
      findRouteById: jest.fn(() => null),
      getRouteByIdForApi: jest.fn(() => null)
    }
  };
}

describe('API mini-app auth protection', () => {
  const secret = 'test-secret';

  it('rejects protected endpoints without token', async () => {
    const deps = createMockDeps();
    const app = createApp({
      ...deps,
      miniAppAuth: createMiniAppAuthMiddleware(secret)
    });

    const response = await request(app).get('/api/sessions?chatId=12345');
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  it('allows protected endpoints with valid token', async () => {
    const deps = createMockDeps();
    const app = createApp({
      ...deps,
      miniAppAuth: createMiniAppAuthMiddleware(secret)
    });
    const token = createMiniAppToken('12345', secret, Date.now());

    const saveResponse = await request(app)
      .post('/api/sessions')
      .set('x-miniapp-auth', token)
      .send({
        chatId: '12345',
        session: {
          sessionId: 'test-session',
          mode: 'planned_route',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationSec: 60,
          distanceM: 1000,
          avgPaceSecPerKm: 300
        }
      });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body.ok).toBe(true);

    const getResponse = await request(app)
      .get('/api/sessions?chatId=12345')
      .set('x-miniapp-auth', token);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.ok).toBe(true);
    expect(Array.isArray(getResponse.body.sessions)).toBe(true);
    expect(getResponse.body.sessions.length).toBe(1);
  });
});
