const CommandHandler = require('../handlers/commandHandler');

function createBotMock() {
  return {
    api: {
      sendMessageToChat: jest.fn().mockResolvedValue(undefined)
    }
  };
}

describe('CommandHandler', () => {
  it('renders profile summary when no history exists', async () => {
    const bot = createBotMock();
    const userService = {
      getUserSession: jest.fn(() => ({ history: [] })),
      getLifetimeStats: jest.fn(() => ({
        totalDistanceM: 1500,
        totalDurationSec: 420,
        totalSessions: 2
      }))
    };

    const handler = new CommandHandler(bot, userService);
    await handler.handleProfile('12345');

    expect(bot.api.sendMessageToChat).toHaveBeenCalledTimes(1);
    const [, text, options] = bot.api.sendMessageToChat.mock.calls[0];
    expect(text).toContain('За всё время');
    expect(text).toContain('У вас пока нет записей');
    expect(options).toEqual({ parse_mode: 'Markdown' });
  });
});
