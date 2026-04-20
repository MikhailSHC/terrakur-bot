const keyboards = require('../keyboards/buttons');
const { formatRouteList, formatRouteDetails } = require('../utils/helpers');
const { createMiniAppToken } = require('../utils/miniAppAuth');

function buildMiniAppUrl(config, chatId, extraParams = {}) {
  const paramsObject = {
    chatId: String(chatId),
    ...extraParams
  };

  if (config.MINI_APP_AUTH_SECRET) {
    paramsObject.authToken = createMiniAppToken(chatId, config.MINI_APP_AUTH_SECRET);
  }

  const params = new URLSearchParams(paramsObject);
  return `${config.MINI_APP_URL}?${params.toString()}`;
}

function getOpenRouteKeyboard(navUrl) {
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [{ type: 'link', text: '🗺️ Открыть маршрут', url: navUrl }],
          [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
        ]
      }
    }
  ];
}

function registerBotHandlers(bot, deps) {
  const {
    config,
    userService,
    routeService,
    commandHandler,
    messageHandler
  } = deps;
  const ROUTES_PAGE_SIZE = 5;

  async function sendRoutesPage(chatId, session, page = 0) {
    const routes = session.availableRoutes || [];
    if (!routes.length) return;

    const totalPages = Math.max(1, Math.ceil(routes.length / ROUTES_PAGE_SIZE));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * ROUTES_PAGE_SIZE;
    const pageRoutes = routes.slice(start, start + ROUTES_PAGE_SIZE);

    let text = '';
    let keyboardOptions = {};

    if (session.routeListMode === 'nearby') {
      text = `📍 Ближайшие маршруты к вам (${currentPage + 1}/${totalPages}):\n\n`;
      pageRoutes.forEach((route, idx) => {
        const routeLengthText = route.distanceText || (route.distanceKm ? `~${route.distanceKm} км` : 'нет данных');
        const distanceKm = typeof route.nearbyDistanceKm === 'number' ? route.nearbyDistanceKm.toFixed(1) : '?';
        text += `${idx + 1}. ${route.name} — ${distanceKm} км от вас\n`;
        text += `   🧭 Длина маршрута: ${routeLengthText}\n`;
        text += `   (${route.nearbyLocationEmoji || ''} ${route.nearbyLocationName || 'Локация не указана'})\n`;
      });
      text += '\nВыберите маршрут (кнопкой ниже):';
      keyboardOptions = {
        page: currentPage,
        pageSize: ROUTES_PAGE_SIZE,
        pagePayloadPrefix: 'nearby_page',
        backPayload: 'main_menu'
      };
    } else {
      text = `📍 Найдено ${routes.length} маршрутов для ${session.selectedActivity.name} в ${session.selectedLocation.name} (${currentPage + 1}/${totalPages}):\n\n`;
      text += formatRouteList(pageRoutes);
      text += '\nВыберите маршрут (кнопкой ниже):';
      keyboardOptions = {
        page: currentPage,
        pageSize: ROUTES_PAGE_SIZE,
        pagePayloadPrefix: 'routes_page',
        backPayload: 'back_to_activities'
      };
    }

    userService.setUserState(chatId, session.routeListMode === 'nearby' ? 'routes_nearby_shown' : 'routes_shown', {
      currentRoutePage: currentPage
    });

    await bot.api.sendMessageToChat(chatId, text, {
      attachments: [keyboards.getRouteKeyboard(routes, keyboardOptions)]
    });
  }

  async function showNearbyRoutesForUser(chatId, latitude, longitude) {
    const routesWithDistance = routeService.getRoutesSortedByDistance(latitude, longitude);

    if (!routesWithDistance.length) {
      await bot.api.sendMessageToChat(chatId, '❌ Пока не могу найти маршруты с координатами рядом с вами.');
      return;
    }

    const nearestRoutes = routesWithDistance.map((item) => {
      const { route, location, distanceKm } = item;
      return {
        ...route,
        locationId: location?.id || null,
        nearbyDistanceKm: distanceKm,
        nearbyLocationName: location?.name || null,
        nearbyLocationEmoji: location?.emoji || ''
      };
    });

    userService.setUserState(chatId, 'routes_nearby_shown', {
      availableRoutes: nearestRoutes,
      selectedLocation: null,
      selectedActivity: null,
      routeListMode: 'nearby',
      currentRoutePage: 0
    });

    const session = userService.getUserSession(chatId);
    await sendRoutesPage(chatId, session, 0);
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
    if (callbackData === 'noop') return;

    if (callbackData === 'main_menu') return commandHandler.handleStart(chatId);
    if (callbackData === 'help') return commandHandler.handleHelp(chatId);
    if (callbackData === 'my_history') return commandHandler.handleProfile(chatId);

    if (callbackData === 'start_free_track') {
      const navUrl = buildMiniAppUrl(config, chatId);
      await bot.api.sendMessageToChat(
        chatId,
        '🧭 Начинаем ваш личный трек!\n\nНажмите кнопку ниже, чтобы открыть трекер.',
        {
          parse_mode: 'Markdown',
          attachments: getOpenRouteKeyboard(navUrl)
        }
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

      userService.setUserState(chatId, 'routes_shown', {
        availableRoutes: routes,
        selectedActivity: activity,
        selectedLocation: session.selectedLocation,
        routeListMode: 'standard',
        currentRoutePage: 0
      });
      const updatedSession = userService.getUserSession(chatId);
      await sendRoutesPage(chatId, updatedSession, 0);
      return;
    }

    if (callbackData.startsWith('routes_page_') || callbackData.startsWith('nearby_page_')) {
      const nextPage = Number.parseInt(callbackData.split('_').pop(), 10);
      if (Number.isNaN(nextPage)) return;
      const session = userService.getUserSession(chatId);
      await sendRoutesPage(chatId, session, nextPage);
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
        `✅ Маршрут *${route.name}* начат!\n\nНажмите кнопку ниже, чтобы открыть навигатор.`,
        {
          parse_mode: 'Markdown',
          attachments: getOpenRouteKeyboard(navUrl)
        }
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
      if (!routes.length) return;
      if (session.routeListMode === 'nearby') {
        await sendRoutesPage(chatId, session, session.currentRoutePage || 0);
        return;
      }
      if (session.selectedLocation && session.selectedActivity) {
        await sendRoutesPage(chatId, session, session.currentRoutePage || 0);
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
