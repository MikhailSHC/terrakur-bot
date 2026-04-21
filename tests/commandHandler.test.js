const CommandHandler = require('../handlers/commandHandler');

function createBotMock() {
  return {
    api: {
      sendMessageToChat: jest.fn().mockResolvedValue(undefined)
    }
  };
}

function createRouteServiceMock() {
  return {
    getActivityById: jest.fn((id) =>
      id === 'running' ? { id: 'running', name: 'Бег', emoji: '🏃' } : null
    ),
    findRouteById: jest.fn((routeId) =>
      routeId === 'r1'
        ? { id: 'r1', name: 'Тест', activities: ['running'] }
        : null
    )
  };
}

describe('CommandHandler', () => {
  it('shows activity picker for profile', async () => {
    const bot = createBotMock();
    const userService = {
      getUserSession: jest.fn(() => ({ history: [] })),
      getLifetimeStats: jest.fn()
    };
    const routeService = createRouteServiceMock();

    const handler = new CommandHandler(bot, userService, routeService);
    await handler.handleProfile('12345');

    expect(bot.api.sendMessageToChat).toHaveBeenCalledTimes(1);
    const [, text, options] = bot.api.sendMessageToChat.mock.calls[0];
    expect(text).toContain('Моя история');
    expect(options.parse_mode).toBe('Markdown');
    expect(options.attachments).toBeDefined();
    expect(options.attachments[0].payload.buttons.length).toBeGreaterThan(0);
  });

  it('renders profile for specific activity', async () => {
    const bot = createBotMock();
    const userService = {
      getUserSession: jest.fn(() => ({
        history: [{ routeName: 'Тест', routeId: 'r1', date: '01.01.2026' }]
      })),
      getLifetimeStatsByActivity: jest.fn(() => ({
        totalDistanceM: 1000,
        totalDurationSec: 300,
        totalSessions: 1
      }))
    };
    const routeService = createRouteServiceMock();

    const handler = new CommandHandler(bot, userService, routeService);
    await handler.handleProfileForActivity('12345', 'running');

    expect(bot.api.sendMessageToChat).toHaveBeenCalledTimes(1);
    const [, text] = bot.api.sendMessageToChat.mock.calls[0];
    expect(text).toContain('Бег');
    expect(text).toContain('Тренировки');
    expect(text).toContain('Тест');
  });
});
