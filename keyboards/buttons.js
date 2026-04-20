// keyboards/buttons.js

// ==================== ГЛАВНОЕ МЕНЮ ====================
const mainMenuKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: '🧭 Начать свой трек', payload: 'start_free_track' }
      ],
      [
        { type: 'callback', text: '📋 Все маршруты', payload: 'find_routes' }
      ],
      [
        { type: 'callback', text: '📍 Маршруты рядом', payload: 'nearby_routes' }
      ],
      [
        { type: 'callback', text: '📊 Моя история', payload: 'my_history' }
      ],
      [
        { type: 'callback', text: '🧾 Мои маршруты', payload: 'my_routes' }
      ],
      [
        { type: 'callback', text: '⚙️ Настройки', payload: 'settings' }
      ],
      [
        { type: 'callback', text: '❓ Помощь', payload: 'help' }
      ]
    ]
  }
};


// ==================== КЛАВИАТУРА С ГОРОДАМИ ====================
const locationKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: 'Stavropol', payload: 'location_stavropol' },
        { type: 'callback', text: 'KavMinVody', payload: 'location_kavminvody' }
      ],
      [
        { type: 'callback', text: 'Kislovodsk', payload: 'location_kislovodsk' },
        { type: 'callback', text: 'Pyatigorsk', payload: 'location_pyatigorsk' }
      ]
    ]
  }
};


// ==================== КЛАВИАТУРА С АКТИВНОСТЯМИ ====================
const activityKeyboard = {
  type: 'inline_keyboard',
  payload: {
    buttons: [
      [
        { type: 'callback', text: '🚶 Walking', payload: 'activity_walking' },
        { type: 'callback', text: '🏃 Running', payload: 'activity_running' }
      ],
      [
        { type: 'callback', text: '🥾 Nordic Walking', payload: 'activity_nordic_walking' },
        { type: 'callback', text: '🚲 Cycling', payload: 'activity_cycling' }
      ],
      [
        { type: 'callback', text: '⬅️ Back to locations', payload: 'back_to_locations' }
      ]
    ]
  }
};


// ==================== КЛАВИАТУРА ДЛЯ ВЫБОРА МАРШРУТА ====================
function getRouteKeyboard(routes) {
  const buttons = [];
  const row = [];

  for (let i = 1; i <= Math.min(routes.length, 5); i++) {
    row.push({ type: 'callback', text: String(i), payload: `route_${i - 1}` });
    if (row.length === 3) {
      buttons.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) buttons.push([...row]);
  buttons.push([{ type: 'callback', text: '⬅️ Back to activities', payload: 'back_to_activities' }]);

  return {
    type: 'inline_keyboard',
    payload: { buttons }
  };
}


// ==================== КЛАВИАТУРА ДЛЯ ДЕТАЛЕЙ МАРШРУТА ====================
function getRouteDetailKeyboard(routeId) {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [
        [{ type: 'callback', text: '✅ START', payload: `start_route_${routeId}` }],
        [{ type: 'callback', text: '⬅️ Back to routes', payload: 'back_to_routes' }],
        [{ type: 'callback', text: '🏠 Main menu', payload: 'main_menu' }]
      ]
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


module.exports = {
  mainMenuKeyboard,
  locationKeyboard,
  activityKeyboard,
  getRouteKeyboard,
  getRouteDetailKeyboard,
  geoRequestKeyboard,
  settingsKeyboard
};