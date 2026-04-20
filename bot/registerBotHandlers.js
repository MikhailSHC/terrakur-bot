const keyboards = require('../keyboards/buttons');
const { formatRouteList, formatRouteDetails } = require('../utils/helpers');
const { createMiniAppToken } = require('../utils/miniAppAuth');

function buildMiniAppUrl(config, chatId, extraParams = {}) {
  const token = createMiniAppToken(chatId, config.MINI_APP_AUTH_SECRET);
  const params = new URLSearchParams({
    chatId: String(chatId),
    authToken: token,
    ...extraParams
  });
  return `${config.MINI_APP_URL}?${params.toString()}`;
}

function registerBotHandlers(bot, deps) {
  const {
    config,
    userService,
    routeService,
    userRoutesService,
    commandHandler,
    messageHandler
  } = deps;

  async function showNearbyRoutesForUser(chatId, latitude, longitude) {
    const routesWithDistance = routeService.getRoutesSortedByDistance(latitude, longitude, { limit: 5 });

    if (!routesWithDistance.length) {
      await bot.api.sendMessageToChat(chatId, '❌ Пока не могу найти маршруты с координатами рядом с вами.');
      return;
    }

    let text = '📍 Ближайшие маршруты к вам:\n\n';
    const nearestRoutes = routesWithDistance.map((item, index) => {
      const { route, location, distanceKm } = item;
      text += `${index + 1}. ${route.name} — ${distanceKm.toFixed(1)} км от вас\n`;
      text += `   (${location?.emoji || ''} ${location?.name || 'Unknown location'})\n`;
      return { ...route, locationId: location?.id || null };
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

  bot.command('start', async (ctx) => {
    const chatId = ctx.chatId;
    if (!chatId) return;
    userService.getUserSession(chatId);
    await commandHandler.handleStart(chatId);
  });

  bot.command('help', async (ctx) => {
    if (ctx.chatId) await commandHandler.handleHelp(ctx.chatId);
  });

  bot.command('profile', async (ctx) => {
    if (ctx.chatId) await commandHandler.handleProfile(ctx.chatId);
  });

  bot.on('message_callback', async (ctx) => {
    const chatId = ctx.message?.recipient?.chat_id || ctx.chatId;
    const callbackData = ctx.callback?.payload;
    if (!chatId || !callbackData) return;

    if (callbackData === 'main_menu') return commandHandler.handleStart(chatId);
    if (callbackData === 'help') return commandHandler.handleHelp(chatId);
    if (callbackData === 'my_history') return commandHandler.handleProfile(chatId);

    if (callbackData === 'my_routes') {
      const routes = userRoutesService.getUserRoutes(chatId);
      if (!routes.length) {
        await bot.api.sendMessageToChat(
          chatId,
          '🧾 У вас пока нет собственных маршрутов.\nНажмите «🧭 Начать свой трек», чтобы записать первый маршрут.'
        );
        return;
      }

      const lastRoutes = routes.slice(-5).reverse();
      let text = '🧾 *Ваши маршруты (free-run):*\n\n';
      lastRoutes.forEach((route, index) => {
        const km = route.distanceM ? (route.distanceM / 1000).toFixed(2) : '0.00';
        const durMin = route.durationSec ? Math.round(route.durationSec / 60) : 0;
        text += `${index + 1}. ${route.name}\n   📏 ${km} км, ⏱ ${durMin} мин\n\n`;
      });

      const buttons = [];
      const row = [];
      for (let i = 0; i < lastRoutes.length; i += 1) {
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
        attachments: [{ type: 'inline_keyboard', payload: { buttons } }]
      });

      userService.setUserState(chatId, 'my_routes_shown', { myRoutesList: lastRoutes });
      return;
    }

    if (callbackData === 'start_free_track') {
      const navUrl = buildMiniAppUrl(config, chatId);
      await bot.api.sendMessageToChat(
        chatId,
        `🧭 Начинаем ваш личный трек!\n\nОткройте трекер по ссылке:\n${navUrl}\n\nНажмите "Старт" в мини-приложении, чтобы начать запись маршрута.`,
        { parse_mode: 'Markdown' }
      );
      userService.setUserState(chatId, 'free_run_started', {
        lastFreeRun: { startedAt: new Date().toISOString() }
      });
      return;
    }

    if (callbackData === 'find_routes') {
      await bot.api.sendMessageToChat(chatId, 'Выберите город:', { attachments: [keyboards.locationKeyboard] });
      return;
    }

    if (callbackData === 'nearby_routes') {
      const session = userService.getUserSession(chatId);
      if (!session.lastLocation) {
        await bot.api.sendMessageToChat(chatId, '📍 Поделитесь вашим местоположением, чтобы я нашёл ближайшие маршруты:', {
          attachments: [keyboards.geoRequestKeyboard]
        });
        return;
      }
      return showNearbyRoutesForUser(chatId, session.lastLocation.latitude, session.lastLocation.longitude);
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
      await bot.api.sendMessageToChat(chatId, '📍 Выберите новое местоположение:', {
        attachments: [keyboards.geoRequestKeyboard]
      });
      return;
    }

    if (callbackData.startsWith('location_')) {
      const locationId = callbackData.replace('location_', '');
      const location = routeService.getLocationById(locationId);
      if (location) {
        userService.setUserState(chatId, 'location_selected', { selectedLocation: location });
        await bot.api.sendMessageToChat(chatId, `✅ Вы выбрали ${location.name}. Теперь выберите активность:`, {
          attachments: [keyboards.activityKeyboard]
        });
      }
      return;
    }

    if (callbackData.startsWith('activity_')) {
      const activityId = callbackData.replace('activity_', '');
      const session = userService.getUserSession(chatId);
      if (!session.selectedLocation) return commandHandler.handleStart(chatId);
      const activity = routeService.getActivityById(activityId);
      if (!activity) return;

      const routes = routeService.getRoutesForLocationAndActivity(session.selectedLocation.id, activity.id);
      if (!routes.length) {
        await bot.api.sendMessageToChat(chatId, `❌ Нет маршрутов для ${activity.name} в ${session.selectedLocation.name}.`);
        return;
      }

      let text = `📍 Найдено ${routes.length} маршрутов для ${activity.name} в ${session.selectedLocation.name}:\n\n`;
      text += formatRouteList(routes.slice(0, 5));
      text += '\nВыберите маршрут (введите номер или нажмите кнопку):';

      userService.setUserState(chatId, 'routes_shown', {
        availableRoutes: routes,
        selectedActivity: activity,
        selectedLocation: session.selectedLocation
      });

      await bot.api.sendMessageToChat(chatId, text, { attachments: [keyboards.getRouteKeyboard(routes)] });
      return;
    }

    if (callbackData.startsWith('route_')) {
      const routeIndex = Number.parseInt(callbackData.replace('route_', ''), 10);
      const session = userService.getUserSession(chatId);
      const routes = session.availableRoutes || [];
      if (!Number.isNaN(routeIndex) && routeIndex >= 0 && routeIndex < routes.length) {
        const route = routes[routeIndex];
        const details = formatRouteDetails(route, {
          locationName: session.selectedLocation?.name,
          activityName: session.selectedActivity?.name
        });
        await bot.api.sendMessageToChat(chatId, details, {
          attachments: [keyboards.getRouteDetailKeyboard(route.id)]
        });
      }
      return;
    }

    if (callbackData.startsWith('myroute_')) {
      const idx = Number.parseInt(callbackData.replace('myroute_', ''), 10);
      const session = userService.getUserSession(chatId);
      const myRoutesList = session.myRoutesList || [];
      if (Number.isNaN(idx) || idx < 0 || idx >= myRoutesList.length) {
        await bot.api.sendMessageToChat(chatId, '❌ Неверный номер маршрута. Пожалуйста, выберите из списка.');
        return;
      }
      const route = myRoutesList[idx];
      const navUrl = buildMiniAppUrl(config, chatId, { userRouteId: route.id });
      await bot.api.sendMessageToChat(
        chatId,
        `✅ Личный маршрут *${route.name}* выбран!\n\nОткройте навигатор по ссылке:\n${navUrl}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (callbackData.startsWith('start_route_')) {
      const routeId = callbackData.replace('start_route_', '');
      const route = routeService.findRouteById(routeId);
      if (!route) {
        await bot.api.sendMessageToChat(chatId, '❌ Маршрут не найден. Попробуйте ещё раз.');
        return;
      }
      userService.addRouteToHistory(chatId, route.name, routeId);
      const navUrl = buildMiniAppUrl(config, chatId, { routeId: route.id });
      await bot.api.sendMessageToChat(
        chatId,
        `✅ Маршрут *${route.name}* начат!\n\nОткройте навигатор по ссылке:\n${navUrl}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (callbackData === 'back_to_locations') {
      await bot.api.sendMessageToChat(chatId, 'Выберите город:', { attachments: [keyboards.locationKeyboard] });
      return;
    }

    if (callbackData === 'back_to_activities') {
      const session = userService.getUserSession(chatId);
      if (session.selectedLocation) {
        await bot.api.sendMessageToChat(chatId, `Выберите активность для ${session.selectedLocation.name}:`, {
          attachments: [keyboards.activityKeyboard]
        });
      }
      return;
    }

    if (callbackData === 'back_to_routes') {
      const session = userService.getUserSession(chatId);
      const routes = session.availableRoutes || [];
      if (routes.length > 0 && session.selectedLocation && session.selectedActivity) {
        let text = `📍 Найдено ${routes.length} маршрутов для ${session.selectedActivity.name} в ${session.selectedLocation.name}:\n\n`;
        text += formatRouteList(routes.slice(0, 5));
        text += '\nВыберите маршрут:';
        await bot.api.sendMessageToChat(chatId, text, { attachments: [keyboards.getRouteKeyboard(routes)] });
      }
    }
  });

  bot.on('message_created', async (ctx) => {
    try {
      const chatId = ctx.chatId || ctx.message?.recipient?.chat_id;
      const message = ctx.message;
      if (!chatId || !message) return;

      const body = message.body || {};
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const locationAttachment = attachments.find((a) => a && a.type === 'location' && a.latitude && a.longitude);

      if (locationAttachment) {
        const lastLocation = {
          latitude: locationAttachment.latitude,
          longitude: locationAttachment.longitude,
          updatedAt: new Date().toISOString()
        };
        userService.setLastLocation(chatId, lastLocation);
        await showNearbyRoutesForUser(chatId, lastLocation.latitude, lastLocation.longitude);
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
}

module.exports = {
  registerBotHandlers
};
