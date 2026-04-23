const { Bot } = require('@maxhub/max-bot-api');
const config = require('./config');
const UserService = require('./services/userService');
const RouteService = require('./services/routeService');
const CommandHandler = require('./handlers/commandHandler');
const MessageHandler = require('./handlers/messageHandler');
const { createMiniAppAuthMiddleware } = require('./middleware/miniAppAuth');
const { createApp } = require('./app/createApp');
const { registerBotHandlers } = require('./bot/registerBotHandlers');
const { createLogger } = require('./utils/logger');

const logger = createLogger('bootstrap');

if (!config.BOT_TOKEN) {
  logger.error('Missing BOT_TOKEN');
  process.exit(1);
}

if (!config.MINI_APP_AUTH_SECRET) {
  logger.warn('MINI_APP_AUTH_SECRET is not configured; mini-app auth relaxed');
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err?.stack || err?.message || String(err) });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

const userService = new UserService();
const routeService = new RouteService();
const miniAppAuth = createMiniAppAuthMiddleware(config.MINI_APP_AUTH_SECRET);

const app = createApp({
  userService,
  routeService,
  miniAppAuth,
  config
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info('HTTP server started', { port: PORT });
});

const bot = new Bot(config.BOT_TOKEN);
const commandHandler = new CommandHandler(bot, userService, routeService, config);
const messageHandler = new MessageHandler(bot, userService, routeService, commandHandler);

registerBotHandlers(bot, {
  config,
  userService,
  routeService,
  commandHandler,
  messageHandler
});

logger.info('Starting bot process');
bot.start()
  .then(() => logger.info('Bot is running'))
  .catch((err) => logger.error('Bot start failed', { error: err.message }));

process.on('SIGINT', () => process.exit(0));