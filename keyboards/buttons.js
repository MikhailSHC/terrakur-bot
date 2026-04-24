// Кнопки и inline-клавиатуры бота

// ==================== ГЛАВНОЕ МЕНЮ ====================
function getMainMenuKeyboard(historyUrl) {
  void historyUrl;

  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [
        [
          { type: 'callback', text: '🧭 Построить свой маршрут', payload: 'start_free_track' }
        ],
        [
          { type: 'callback', text: '📋 Маршруты Ставрополья', payload: 'find_routes' }
        ],
        [
          { type: 'callback', text: '📍 Рядом со мной', payload: 'nearby_routes' }
        ],
        [
          { type: 'callback', text: '📡 Поделиться геолокацией', payload: 'share_location' }
        ],
        [
          { type: 'callback', text: '❓ Помощь', payload: 'help' }
        ]
      ]
    }
  };
}


// ==================== КЛАВИАТУРА С ГОРОДАМИ ====================
const locationKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: 'Ставрополь', payload: 'location_stavropol' },
        { type: 'callback', text: 'Минеральные Воды', payload: 'location_kavminvody' }
      ],
      [
        { type: 'callback', text: 'Кисловодск', payload: 'location_kislovodsk' },
        { type: 'callback', text: 'Пятигорск', payload: 'location_pyatigorsk' }
      ],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};


// ==================== КЛАВИАТУРА С АКТИВНОСТЯМИ ====================
const activityKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: '🥾 Скандинавская ходьба', payload: 'activity_nordic_walking' },
        { type: 'callback', text: '🏃 Бег', payload: 'activity_running' }
      ],
      [
        { type: 'callback', text: '🚲 Велопрогулка', payload: 'activity_cycling' }
      ],
      [
        { type: 'callback', text: '⬅️ К выбору города', payload: 'back_to_locations' }
      ],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};


// ==================== КЛАВИАТУРА ДЛЯ ВЫБОРА МАРШРУТА ====================
function getRouteKeyboard(routes, options = {}) {
  const {
    page = 0,
    pageSize = 5,
    pagePayloadPrefix = 'routes_page',
    backPayload = 'back_to_activities',
    backButtonText = '⬅️ К выбору активности'
  } = options;

  const totalPages = Math.max(1, Math.ceil(routes.length / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * pageSize;
  const end = Math.min(start + pageSize, routes.length);

  const buttons = [];
  const row = [];

  for (let i = start; i < end; i++) {
    row.push({ type: 'callback', text: String(i + 1), payload: `route_${i}` });
    if (row.length === 3) {
      buttons.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) buttons.push([...row]);

  if (totalPages > 1) {
    buttons.push([
      { type: 'callback', text: '⬅️', payload: `${pagePayloadPrefix}_${Math.max(0, currentPage - 1)}` },
      { type: 'callback', text: `${currentPage + 1}/${totalPages}`, payload: 'noop' },
      { type: 'callback', text: '➡️', payload: `${pagePayloadPrefix}_${Math.min(totalPages - 1, currentPage + 1)}` }
    ]);
  }

  buttons.push([{ type: 'callback', text: backButtonText, payload: backPayload }]);
  if (backPayload !== 'main_menu') {
    buttons.push([{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]);
  }

  return {
    type: 'inline_keyboard',
    payload: { buttons }
  };
}


// ==================== КЛАВИАТУРА ДЛЯ ДЕТАЛЕЙ МАРШРУТА ====================
function getRouteDetailKeyboard(routeId, options = {}) {
  const { mapUrl = null } = options;
  const buttons = [];

  if (mapUrl) {
    buttons.push([{ type: 'link', text: '✅ Начать маршрут', url: mapUrl }]);
  } else {
    buttons.push([{ type: 'callback', text: '✅ Начать маршрут', payload: `start_route_${routeId}` }]);
  }
    buttons.push([{ type: 'callback', text: '⬅️ Вернуться к списку', payload: 'back_to_routes' }]);
  buttons.push([{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]);

  return {
    type: 'inline_keyboard',
    payload: {
      buttons
    }
  };
}


// ==================== КЛАВИАТУРА ДЛЯ ГЕОЛОКАЦИИ ====================
const geoRequestKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        {
          type: 'request_geo_location',
          text: '📍 Поделиться местоположением',
          payload: 'geo_request'
        }
      ],
      [
        { type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }
      ]
    ]
  }
};

const settingsKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        {
          type: 'request_geo_location',
          text: '📍 Изменить местоположение',
          payload: 'change_location'
        }
      ],
      [
        { type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }
      ]
    ]
  }
};

/** Выбор активности перед «Рядом со мной» (payload: pick_nearby_activity_<id>) */
const nearbyActivityPickKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: '🥾 Скандинавская ходьба', payload: 'pick_nearby_activity_nordic_walking' },
        { type: 'callback', text: '🏃 Бег', payload: 'pick_nearby_activity_running' }
      ],
      [
        { type: 'callback', text: '🚲 Велопрогулка', payload: 'pick_nearby_activity_cycling' }
      ],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};

/** Выбор активности перед свободным треком (payload: pick_free_activity_<id>) */
const freeTrackActivityPickKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: '🥾 Скандинавская ходьба', payload: 'pick_free_activity_nordic_walking' },
        { type: 'callback', text: '🏃 Бег', payload: 'pick_free_activity_running' }
      ],
      [
        { type: 'callback', text: '🚲 Велопрогулка', payload: 'pick_free_activity_cycling' }
      ],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};

/** Профиль / история по виду активности */
const profileActivityPickKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [{ type: 'callback', text: '📊 Все виды сразу', payload: 'pick_profile_activity_all' }],
      [
        { type: 'callback', text: '🥾 Скандинавская ходьба', payload: 'pick_profile_activity_nordic_walking' },
        { type: 'callback', text: '🏃 Бег', payload: 'pick_profile_activity_running' }
      ],
      [
        { type: 'callback', text: '🚲 Велопрогулка', payload: 'pick_profile_activity_cycling' }
      ],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};

/** Навигация в экранах статистики по выбранной активности */
const profileActivityResultKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [{ type: 'callback', text: '⬅️ К выбору активности', payload: 'my_history' }],
      [{ type: 'callback', text: '🏠 Главное меню', payload: 'main_menu' }]
    ]
  }
};


module.exports = {
  getMainMenuKeyboard,
  locationKeyboard,
  activityKeyboard,
  getRouteKeyboard,
  getRouteDetailKeyboard,
  geoRequestKeyboard,
  settingsKeyboard,
  nearbyActivityPickKeyboard,
  freeTrackActivityPickKeyboard,
  profileActivityPickKeyboard,
  profileActivityResultKeyboard
};