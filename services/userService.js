const fs = require('fs');
const path = require('path');
const config = require('../config');

class UserService {
  constructor() {
    this.dataFile = path.join(__dirname, '..', config.USER_DATA_FILE);
    this.userData = {};
    this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const rawData = fs.readFileSync(this.dataFile, 'utf8');
        this.userData = JSON.parse(rawData) || {};
        console.log(`✅ Загружены данные для ${Object.keys(this.userData).length} пользователей`);
      } else {
        console.log('📁 Файл с данными не найден, будет создан новый');
        this.userData = {};
      }
    } catch (error) {
      console.error('❌ Ошибка загрузки данных пользователей:', error.message);
      this.userData = {};
    }
  }

  saveData() {
    try {
      const data = JSON.stringify(this.userData, null, 2);
      fs.writeFileSync(this.dataFile, data, 'utf8');
      console.log(`💾 Сохранены данные для ${Object.keys(this.userData).length} пользователей`);
    } catch (error) {
      console.error('❌ Ошибка сохранения данных пользователей:', error.message);
      throw new Error('Не удалось сохранить данные пользователя');
    }
  }

  // Гарантировано возвращает объект пользователя с нужными полями
  getUserSession(chatId) {
    const id = String(chatId);

    if (!this.userData[id]) {
      this.userData[id] = {
        chatId: id,
        state: 'start',
        selectedLocation: null,
        selectedActivity: null,
        availableRoutes: [],
        history: [],
        sessions: [],
        userRoutes: [],
        lastLocation: null,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      console.log(`👤 Создан новый пользователь: ${id}`);
      this.saveData();
      return this.userData[id];
    }

    const u = this.userData[id];

    // Миграция/инициализация недостающих полей
    if (!Array.isArray(u.history)) u.history = [];
    if (!Array.isArray(u.sessions)) u.sessions = [];
    if (!Array.isArray(u.userRoutes)) u.userRoutes = [];
    if (!('lastLocation' in u)) u.lastLocation = null;
    if (!u.createdAt) u.createdAt = new Date().toISOString();
    if (!u.lastUpdated) u.lastUpdated = new Date().toISOString();

    return u;
  }

  setUserState(chatId, state, extraData = {}) {
    const id = String(chatId);
    const session = this.getUserSession(id);

    session.state = state;
    session.lastUpdated = new Date().toISOString();

    Object.keys(extraData).forEach(key => {
      if (extraData[key] !== undefined) {
        session[key] = extraData[key];
      }
    });

    this.saveData();
    console.log(`🔄 Обновлено состояние пользователя ${id}: ${state}`);
  }

  addRouteToHistory(chatId, routeName, routeId) {
    const id = String(chatId);
    const session = this.getUserSession(id);

    const historyEntry = {
      routeName: routeName,
      routeId: routeId,
      date: new Date().toLocaleString(),
      completed: true,
      timestamp: new Date().toISOString()
    };

    session.history.push(historyEntry);

    if (session.history.length > 50) {
      session.history = session.history.slice(-50);
    }

    session.lastUpdated = new Date().toISOString();
    this.saveData();

    console.log(`📝 Добавлен маршрут "${routeName}" для пользователя ${id}`);
  }

  getUserHistory(chatId, limit = 5) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.history.slice(-limit);
  }

  getUserState(chatId) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.state;
  }

  getUserSelectedLocation(chatId) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.selectedLocation;
  }

  getUserSelectedActivity(chatId) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.selectedActivity;
  }

  getUserAvailableRoutes(chatId) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.availableRoutes || [];
  }

  clearUserData(chatId) {
    const id = String(chatId);
    if (this.userData[id]) {
      delete this.userData[id];
      this.saveData();
      console.log(`🗑️ Удалены данные пользователя ${id}`);
    }
  }

  getStatistics() {
    const totalUsers = Object.keys(this.userData).length;
    let totalCompletedRoutes = 0;

    Object.values(this.userData).forEach(user => {
      if (Array.isArray(user.history)) {
        totalCompletedRoutes += user.history.length;
      }
    });

    const lastDay = new Date();
    lastDay.setDate(lastDay.getDate() - 1);

    const activeUsers = Object.values(this.userData).filter(u => {
      return u.lastUpdated && new Date(u.lastUpdated) > lastDay;
    }).length;

    return {
      totalUsers,
      totalCompletedRoutes,
      activeUsers
    };
  }

  // === Новое: геолокация пользователя ===
  setLastLocation(chatId, lastLocation) {
    const session = this.getUserSession(chatId);
    session.lastLocation = lastLocation;
    session.lastUpdated = new Date().toISOString();
    this.saveData();
  }

  // === Новое: тренировочные сессии ===
  addSession(chatId, sessionData) {
    const session = this.getUserSession(chatId);
    if (!Array.isArray(session.sessions)) session.sessions = [];

    const sessionId = sessionData.id || Date.now().toString();
    const record = { id: sessionId, ...sessionData };

    session.sessions.push(record);

    if (session.sessions.length > 500) {
      session.sessions = session.sessions.slice(-500);
    }

    session.lastUpdated = new Date().toISOString();
    this.saveData();

    return record;
  }

  getSessions(chatId, limit = null) {
    const session = this.getUserSession(chatId);
    const sessions = Array.isArray(session.sessions) ? session.sessions : [];
    if (limit && sessions.length > limit) {
      return sessions.slice(-limit);
    }
    return sessions;
  }

  // === Новое: личные маршруты (free-run) ===
  addUserRoute(chatId, userRoute) {
    const session = this.getUserSession(chatId);
    if (!Array.isArray(session.userRoutes)) session.userRoutes = [];

    session.userRoutes.push(userRoute);
    session.lastUpdated = new Date().toISOString();
    this.saveData();
  }

  getUserRoutes(chatId) {
    const session = this.getUserSession(chatId);
    return Array.isArray(session.userRoutes) ? session.userRoutes : [];
  }

  getUserRouteById(chatId, routeId) {
    const routes = this.getUserRoutes(chatId);
    return routes.find(r => r.id === routeId) || null;
  }
}

module.exports = UserService;