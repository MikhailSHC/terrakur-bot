const { Bot } = require('@maxhub/max-bot-api');
const config = require('./config');
const UserService = require('./services/userService');
const RouteService = require('./services/routeService');
const CommandHandler = require('./handlers/commandHandler');
const MessageHandler = require('./handlers/messageHandler');
const { createMiniAppAuthMiddleware } = require('./middleware/miniAppAuth');
const { createApp } = require('./app/createApp');
const { registerBotHandlers } = require('./bot/registerBotHandlers');

if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в переменных окружения');
  process.exit(1);
}

if (!config.MINI_APP_AUTH_SECRET) {
  console.warn('⚠️ MINI_APP_AUTH_SECRET не задан, mini-app auth отключен');
}

process.on('uncaughtException', (err) => {
  console.error('💥 НЕ ПЕРЕХВАЧЕННАЯ ОШИБКА:');
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 НЕ ОБРАБОТАННЫЙ PROMISE:');
  console.error(reason);
});

const userService = new UserService();
const routeService = new RouteService();
const miniAppAuth = createMiniAppAuthMiddleware(config.MINI_APP_AUTH_SECRET);

const app = createApp({
  userService,
  routeService,
  miniAppAuth
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Mini-app server listening on port ${PORT}`);
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

console.log('🚀 Запуск бота...');
bot.start()
  .then(() => console.log('✅ TerraKur bot for MAX is running!'))
  .catch((err) => console.error('❌ Ошибка запуска:', err.message));

process.on('SIGINT', () => process.exit(0));