const { Bot } = require('@maxhub/max-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const UserService = require('./services/userService');
const RouteService = require('./services/routeService');
const UserRoutesService = require('./services/userRoutesService');
const CommandHandler = require('./handlers/commandHandler');
const MessageHandler = require('./handlers/messageHandler');
const keyboards = require('./keyboards/buttons');
const { formatRouteList, formatRouteDetails } = require('./utils/helpers');

// Отлавливаем все ошибки
process.on('uncaughtException', (err) => {
  console.error('='.repeat(50));
  console.error('💥 НЕ ПЕРЕХВАЧЕННАЯ ОШИБКА:');
  console.error(err.stack);
  console.error('='.repeat(50));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('='.repeat(50));
  console.error('💥 НЕ ОБРАБОТАННЫЙ ПРОМИС:');
  console.error(reason);
  console.error('='.repeat(50));
});

// ==================== EXPRESS / MINI-APP / API ====================

const app = express();
app.use(express.json());

// Статика mini-app
app.use(express.static(path.join(__dirname, 'public')));

// Инициализация сервисов до API
const userService = new UserService();
const routeService = new RouteService();
const userRoutesService = new UserRoutesService();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API is alive' });
});

// API: получить маршрут по id
app.get('/api/routes/:id', (req, res) => {
  try {
    const routeId = req.params.id;
    const route = routeService.getRouteByIdForApi(routeId);

    if (!route) {
      return res.status(404).json({
        ok: false,
        error: 'Route not found'
      });
    }

    return res.json({
      ok: true,
      route
    });
  } catch (error) {
    console.error('❌ API /api/routes/:id error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// ==================== НОВЫЕ API ДЛЯ MINI-APP ====================

// Получение списка маршрутов (системные + пользовательские)
app.get('/api/routes', (req, res) => {
  try {
    const geojsonPath = path.join(__dirname, 'public/mini-app/routes.geojson');
    let systemRoutes = [];
    if (fs.existsSync(geojsonPath)) {
      const data = fs.readFileSync(geojsonPath, 'utf8');
      const geojson = JSON.parse(data);
      systemRoutes = geojson.features.map(f => ({
        id: f.properties.id,
        name: f.properties.name,
        type: 'system',
        geojson: f
      }));
    }
    const userRoutes = [];
    res.json({ ok: true, routes: [...systemRoutes, ...userRoutes] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Получение одного системного маршрута по ID (в GeoJSON)
app.get('/api/routes/:id/geojson', (req, res) => {
  const id = req.params.id;
  try {
    const geojsonPath = path.join(__dirname, 'public/mini-app/routes.geojson');
    const data = fs.readFileSync(geojsonPath, 'utf8');
    const geojson = JSON.parse(data);
    const feature = geojson.features.find(f => f.properties.id === id);
    if (!feature) return res.status(404).json({ ok: false, error: 'Route not found' });
    res.json({ ok: true, route: feature });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Сохранение тренировочной сессии + создание пользовательских маршрутов + запись в историю
app.post('/api/sessions', (req, res) => {
  const { chatId, session } = req.body;
  if (!chatId || !session) {
    return res.status(400).json({ ok: false, error: 'Missing data' });
  }

  try {
    const userDataPath = path.join(__dirname, config.USER_DATA_FILE);
    let allUsers = {};
    if (fs.existsSync(userDataPath)) {
      allUsers = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    }

    if (!allUsers[chatId]) {
      allUsers[chatId] = { sessions: [], userRoutes: [] };
    }
    if (!allUsers[chatId].sessions) allUsers[chatId].sessions = [];
    if (!allUsers[chatId].userRoutes) allUsers[chatId].userRoutes = [];

    // ---- Сохраняем саму тренировочную сессию ----
    const sessionId = session.sessionId || Date.now().toString();

    const sessionRecord = {
      id: sessionId,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      durationSec: session.durationSec,
      distanceM: session.distanceM,
      avgPaceSecPerKm: session.avgPaceSecPerKm,
      geojson: session.geojson,
      mode: session.mode,
      plannedRouteId: session.plannedRouteId || null
    };

    allUsers[chatId].sessions.push(sessionRecord);

    // ---- Если это free_run — создаём пользовательский маршрут ----
    if (session.mode === 'free_run' && session.geojson && session.geojson.features?.length) {
      const line = session.geojson.features[0];
      if (line.geometry && Array.isArray(line.geometry.coordinates)) {
        const coords = line.geometry.coordinates;
        if (coords.length > 1) {
          const start  = coords[0];                     // [lon, lat]
          const end    = coords[coords.length - 1];
          const center = coords[Math.floor(coords.length / 2)];

          const userRoute = {
            id: `user_${sessionId}`,
            name: session.name || `Мой маршрут ${new Date(session.startedAt).toLocaleString()}`,
            createdAt: session.startedAt,
            distanceM: session.distanceM,
            durationSec: session.durationSec,
            avgPaceSecPerKm: session.avgPaceSecPerKm,
            start:  { lon: start[0],  lat: start[1] },
            end:    { lon: end[0],    lat: end[1] },
            center: { lon: center[0], lat: center[1] },
            geojson: session.geojson
          };

          allUsers[chatId].userRoutes.push(userRoute);

          // === free-run в историю бота ===
          userService.addRouteToHistory(chatId, userRoute.name, userRoute.id);
        }
      }
    }

    // ---- Если это planned_route — пишем в историю по имени системного маршрута ----
    if (session.mode === 'planned_route' && session.plannedRouteId) {
      const route = routeService.findRouteById(session.plannedRouteId);
      const historyRouteName = route ? route.name : `Маршрут ${session.plannedRouteId}`;
      userService.addRouteToHistory(chatId, historyRouteName, session.plannedRouteId);
    }

    fs.writeFileSync(userDataPath, JSON.stringify(allUsers, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Получение истории тренировок пользователя
app.get('/api/sessions', (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) return res.status(400).json({ ok: false, error: 'chatId required' });
  try {
    const userDataPath = path.join(__dirname, config.USER_DATA_FILE);
    if (!fs.existsSync(userDataPath)) return res.json({ ok: true, sessions: [] });
    const allUsers = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    const sessions = allUsers[chatId]?.sessions || [];
    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Получение одного пользовательского маршрута по id
app.get('/api/user-routes/:id', (req, res) => {
  const chatId = req.query.chatId;
  const routeId = req.params.id;

  if (!chatId) {
    return res.status(400).json({ ok: false, error: 'chatId required' });
  }

  try {
    const userDataPath = path.join(__dirname, config.USER_DATA_FILE);
    if (!fs.existsSync(userDataPath)) {
      return res.status(404).json({ ok: false, error: 'User data not found' });
    }
    const allUsers = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    const user = allUsers[String(chatId)] || {};
    const routes = Array.isArray(user.userRoutes) ? user.userRoutes : [];
    const route = routes.find(r => r.id === routeId);

    if (!route) {
      return res.status(404).json({ ok: false, error: 'User route not found' });
    }

    return res.json({ ok: true, route });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Запуск HTTP-сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Mini-app server listening on port ${PORT}`);
});

// ==================== BOT ====================

const bot = new Bot(config.BOT_TOKEN);

// Хендлеры
const commandHandler = new CommandHandler(bot, userService);
const messageHandler = new MessageHandler(bot, userService, routeService, commandHandler);

// ==================== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ====================

async function showNearbyRoutesForUser(chatId, latitude, longitude) {
  const routesWithDistance = routeService.getRoutesSortedByDistance(
    latitude,
    longitude,
    { limit: 5 }
  );

  if (!routesWithDistance.length) {
    await bot.api.sendMessageToChat(
      chatId,
      '❌ Пока не могу найти маршруты с координатами рядом с вами.'
    );
    return;
  }

  let text = `📍 Ближайшие маршруты к вам:\n\n`;

  const nearestRoutes = routesWithDistance.map((item, index) => {
    const { route, location, distanceKm } = item;
    const dist = distanceKm.toFixed(1);

    text += `${index + 1}. ${route.name} — ${dist} км от вас\n`;
    text += `   (${location?.emoji || ''} ${location?.name || 'Unknown location'})\n`;

    return {
      ...route,
      locationId: location?.id || null
    };
  });

  text += '\nВыберите маршрут (введите номер или нажмите кнопку):';

  userService.setUserState(chatId, 'routes_nearby_shown', {
    availableRoutes: nearestRoutes,
    selectedLocation: null,
    selectedActivity: null
  });

  await bot.api.sendMessageToChat(chatId, text, {
    attachments: [keyboards.getRouteKeyboard(nearestRoutes)]
  });
}

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

bot.command('start', async (ctx) => {
  console.log('✅ Получена команда /start');
  const chatId = ctx.chatId;

  if (chatId) {
    userService.getUserSession(chatId);
    await commandHandler.handleStart(chatId);
  }
});

bot.command('help', async (ctx) => {
  const chatId = ctx.chatId;
  if (chatId) {
    await commandHandler.handleHelp(chatId);
  }
});

bot.command('profile', async (ctx) => {
  const chatId = ctx.chatId;
  if (chatId) {
    await commandHandler.handleProfile(chatId);
  }
});

// ==================== ОБРАБОТЧИК CALLBACK ====================

bot.on('message_callback', async (ctx) => {
  console.log('🔔🔔🔔 MESSAGE_CALLBACK ПОЛУЧЕН 🔔🔔🔔');

  console.log('=== SAFE CTX (message_callback) START ===');
  console.log('callback:', ctx.callback);
  console.log('message:', ctx.message);
  console.log('=== SAFE CTX (message_callback) END ===');

  const chatId = ctx.message?.recipient?.chat_id || ctx.chatId;
  const callbackData = ctx.callback?.payload;

  console.log('chatId:', chatId);
  console.log('callbackData:', callbackData);

  if (!chatId || !callbackData) {
    console.log('❌ Нет chatId или callbackData');
    return;
  }

  if (callbackData === 'main_menu') {
    await commandHandler.handleStart(chatId);
    return;
  }

  if (callbackData === 'help') {
    await commandHandler.handleHelp(chatId);
    return;
  }

  if (callbackData === 'my_history') {
    await commandHandler.handleProfile(chatId);
    return;
  }

  if (callbackData === 'my_routes') {
    const routes = userRoutesService.getUserRoutes(chatId);

    if (!routes.length) {
      await bot.api.sendMessageToChat(
        chatId,
        '🧾 У вас пока нет собственных маршрутов.\n' +
        'Нажмите «🧭 Начать свой трек», чтобы записать первый маршрут.'
      );
      return;
    }

    const lastRoutes = routes.slice(-5).reverse();
    let text = '🧾 *Ваши маршруты (free-run):*\n\n';

    lastRoutes.forEach((route, index) => {
      const km = route.distanceM ? (route.distanceM / 1000).toFixed(2) : '0.00';
      const durMin = route.durationSec ? Math.round(route.durationSec / 60) : 0;
      text += `${index + 1}. ${route.name}\n`;
      text += `   📏 ${km} км, ⏱ ${durMin} мин\n\n`;
    });

    const buttons = [];
    const row = [];
    for (let i = 0; i < lastRoutes.length; i++) {
      row.push({ type: 'callback', text: String(i + 1), payload: `myroute_${i}` });
      if (row.length === 3) {
        buttons.push([...row]);
        row.length = 0;
      }
    }
    if (row.length) buttons.push([...row]);
    buttons.push([{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]);

    await bot.api.sendMessageToChat(chatId, text, {
      parse_mode: 'Markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons }
        }
      ]
    });

    userService.setUserState(chatId, 'my_routes_shown', {
      myRoutesList: lastRoutes
    });

    return;
  }

  // ===== НАЧАТЬ СВОЙ ТРЕК (free_run) =====
  if (callbackData === 'start_free_track') {
    const navUrl = `${config.MINI_APP_URL}?chatId=${encodeURIComponent(chatId)}`;

    await bot.api.sendMessageToChat(
      chatId,
      '🧭 Начинаем ваш личный трек!\n\n' +
      'Откройте трекер по ссылке:\n' +
      `${navUrl}\n\n` +
      'Нажмите "Старт" в мини-приложении, чтобы начать запись маршрута.',
      { parse_mode: 'Markdown' }
    );

    userService.setUserState(chatId, 'free_run_started', {
      lastFreeRun: {
        startedAt: new Date().toISOString()
      }
    });

    return;
  }

  if (callbackData === 'find_routes') {
    await bot.api.sendMessageToChat(chatId, 'Выберите город:', {
      attachments: [keyboards.locationKeyboard]
    });
    return;
  }

  if (callbackData === 'nearby_routes') {
    const session = userService.getUserSession(chatId);

    if (!session.lastLocation) {
      await bot.api.sendMessageToChat(
        chatId,
        '📍 Поделитесь вашим местоположением, чтобы я нашёл ближайшие маршруты:',
        { attachments: [keyboards.geoRequestKeyboard] }
      );
      return;
    }

    const { latitude, longitude } = session.lastLocation;
    await showNearbyRoutesForUser(chatId, latitude, longitude);
    return;
  }

  if (callbackData === 'settings') {
    await bot.api.sendMessageToChat(
      chatId,
      '⚙️ Настройки:\n\nВы можете изменить сохранённое местоположение для поиска маршрутов рядом.',
      { attachments: [keyboards.settingsKeyboard] }
    );
    return;
  }

  if (callbackData === 'change_location') {
    await bot.api.sendMessageToChat(
      chatId,
      '📍 Выберите новое местоположение:',
      { attachments: [keyboards.geoRequestKeyboard] }
    );
    return;
  }

  if (callbackData.startsWith('location_')) {
    const locationId = callbackData.replace('location_', '');
    let location = null;

    if (locationId === 'stavropol') location = routeService.getLocationById('stavropol');
    else if (locationId === 'kavminvody') location = routeService.getLocationById('kavminvody');
    else if (locationId === 'kislovodsk') location = routeService.getLocationById('kislovodsk');
    else if (locationId === 'pyatigorsk') location = routeService.getLocationById('pyatigorsk');

    if (location) {
      userService.setUserState(chatId, 'location_selected', { selectedLocation: location });

      await bot.api.sendMessageToChat(
        chatId,
        `✅ Вы выбрали ${location.name}. Теперь выберите активность:`,
        { attachments: [keyboards.activityKeyboard] }
      );
    }
    return;
  }

  if (callbackData.startsWith('activity_')) {
    const activityId = callbackData.replace('activity_', '');
    const session = userService.getUserSession(chatId);
    const location = session.selectedLocation;

    if (!location) {
      await commandHandler.handleStart(chatId);
      return;
    }

    let activity = null;
    if (activityId === 'walking') activity = routeService.getActivityById('walking');
    else if (activityId === 'running') activity = routeService.getActivityById('running');
    else if (activityId === 'nordic_walking') activity = routeService.getActivityById('nordic_walking');
    else if (activityId === 'cycling') activity = routeService.getActivityById('cycling');

    if (activity) {
      const routes = routeService.getRoutesForLocationAndActivity(location.id, activity.id);

      if (routes.length > 0) {
        let text = `📍 Найдено ${routes.length} маршрутов для ${activity.name} в ${location.name}:\n\n`;
        text += formatRouteList(routes.slice(0, 5));
        text += '\nВыберите маршрут (введите номер или нажмите кнопку):';

        userService.setUserState(chatId, 'routes_shown', {
          availableRoutes: routes,
          selectedActivity: activity,
          selectedLocation: location
        });

        await bot.api.sendMessageToChat(chatId, text, {
          attachments: [keyboards.getRouteKeyboard(routes)]
        });
      } else {
        await bot.api.sendMessageToChat(
          chatId,
          `❌ Нет маршрутов для ${activity.name} в ${location.name}.`
        );
      }
    }
    return;
  }

  if (callbackData.startsWith('route_')) {
    const routeIndex = parseInt(callbackData.replace('route_', ''), 10);
    const session = userService.getUserSession(chatId);
    const routes = session.availableRoutes || [];
    const location = session.selectedLocation;
    const activity = session.selectedActivity;

    if (!Number.isNaN(routeIndex) && routeIndex >= 0 && routeIndex < routes.length) {
      const route = routes[routeIndex];
      const details = formatRouteDetails(route, {
        locationName: location?.name,
        activityName: activity?.name
      });

      await bot.api.sendMessageToChat(chatId, details, {
        attachments: [keyboards.getRouteDetailKeyboard(route.id)]
      });
    } else {
      await bot.api.sendMessageToChat(
        chatId,
        '❌ Неверный маршрут. Пожалуйста, выберите номер из кнопок.'
      );
    }
    return;
  }

  if (callbackData.startsWith('myroute_')) {
    const idx = parseInt(callbackData.replace('myroute_', ''), 10);
    const session = userService.getUserSession(chatId);
    const myRoutesList = session.myRoutesList || [];

    if (Number.isNaN(idx) || idx < 0 || idx >= myRoutesList.length) {
      await bot.api.sendMessageToChat(
        chatId,
        '❌ Неверный номер маршрута. Пожалуйста, выберите из списка.'
      );
      return;
    }

    const route = myRoutesList[idx];

    const navUrl = `${config.MINI_APP_URL}?chatId=${encodeURIComponent(chatId)}&userRouteId=${encodeURIComponent(route.id)}`;

    await bot.api.sendMessageToChat(
      chatId,
      `✅ Личный маршрут *${route.name}* выбран!\n\n` +
      `Откройте навигатор по ссылке:\n` +
      `${navUrl}`,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  if (callbackData.startsWith('start_route_')) {
    const routeId = callbackData.replace('start_route_', '');
    console.log('▶️ start_route_ callback, routeId =', routeId, 'chatId =', chatId);

    const route = routeService.findRouteById(routeId);
    console.log('Найден маршрут:', route ? route.name : 'НЕ НАЙДЕН');

    if (route) {
      userService.addRouteToHistory(chatId, route.name, routeId);

      const navUrl = `${config.MINI_APP_URL}?routeId=${encodeURIComponent(route.id)}&chatId=${encodeURIComponent(chatId)}`;
      console.log('navUrl =', navUrl);

      await bot.api.sendMessageToChat(
        chatId,
        `✅ Маршрут *${route.name}* начат!\n\n` +
        `Откройте навигатор по ссылке:\n` +
        `${navUrl}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      console.log('❌ routeService.findRouteById не нашёл маршрут для id =', routeId);

      await bot.api.sendMessageToChat(
        chatId,
        '❌ Маршрут не найден. Попробуйте ещё раз.'
      );
    }
    return;
  }

  if (callbackData === 'back_to_locations') {
    await bot.api.sendMessageToChat(chatId, 'Выберите город:', {
      attachments: [keyboards.locationKeyboard]
    });
    return;
  }

  if (callbackData === 'back_to_activities') {
    const session = userService.getUserSession(chatId);
    const location = session.selectedLocation;

    if (location) {
      await bot.api.sendMessageToChat(
        chatId,
        `Выберите активность для ${location.name}:`,
        { attachments: [keyboards.activityKeyboard] }
      );
    }
    return;
  }

  if (callbackData === 'back_to_routes') {
    const session = userService.getUserSession(chatId);
    const routes = session.availableRoutes || [];
    const location = session.selectedLocation;
    const activity = session.selectedActivity;

    if (routes.length > 0 && location && activity) {
      let text = `📍 Найдено ${routes.length} маршрутов для ${activity.name} в ${location.name}:\n\n`;
      text += formatRouteList(routes.slice(0, 5));
      text += '\nВыберите маршрут:';

      await bot.api.sendMessageToChat(chatId, text, {
        attachments: [keyboards.getRouteKeyboard(routes)]
      });
    }
    return;
  }

  console.log(`⚠️ НЕИЗВЕСТНЫЙ callback: ${callbackData}`);
});

// ==================== ОБРАБОТЧИК ГЕОЛОКАЦИИ / ТЕКСТА ====================

bot.on('message_created', async (ctx) => {
  console.log('=== SAFE CTX (message_created) START ===');
  console.log('chatId from ctx.chatId:', ctx.chatId);
  console.log('raw message:', JSON.stringify(ctx.message, null, 2));
  console.log('=== SAFE CTX (message_created) END ===');

  try {
    const chatId = ctx.chatId || ctx.message?.recipient?.chat_id;
    const message = ctx.message;

    if (!chatId || !message) {
      console.log('❌ Нет chatId или message в message_created');
      return;
    }

    const body = message.body || {};

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const locationAttachment = attachments.find(
      (a) => a && a.type === 'location' && a.latitude && a.longitude
    );

    if (locationAttachment) {
      const latitude = locationAttachment.latitude;
      const longitude = locationAttachment.longitude;

      console.log('📍 Получена геолокация (из attachments)!');
      console.log('Широта:', latitude);
      console.log('Долгота:', longitude);

      const lastLocation = {
        latitude,
        longitude,
        updatedAt: new Date().toISOString()
      };

      userService.setUserState(chatId, 'geo_saved', { lastLocation });

      await showNearbyRoutesForUser(chatId, latitude, longitude);
      return;
    }

    let messageText = body.text;
    if (!messageText && typeof body === 'string') {
      messageText = body;
    }

    if (messageText && !messageText.startsWith('/')) {
      await messageHandler.handleTextMessage(chatId, messageText);
    }
  } catch (error) {
    console.error('❌ Ошибка в message_created:', error.message);
  }
});

// ==================== ЗАПУСК БОТА ====================

console.log('🚀 Запуск бота...');
bot.start()
  .then(() => console.log('✅ TerraKur bot for MAX is running!'))
  .catch(err => console.error('❌ Ошибка запуска:', err.message));

process.on('SIGINT', () => process.exit(0));