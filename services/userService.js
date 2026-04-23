const fs = require('fs');
const path = require('path');
const config = require('../config');
const { estimateWorkoutCaloriesKcal } = require('../utils/estimateCalories');

class UserService {
  constructor() {
    this.dataFile = path.join(__dirname, '..', config.USER_DATA_FILE);
    this.userData = {};
    this.loadData();
  }

  sanitizeSessionRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const distanceM = Number(record.distanceM) || 0;
    const durationSec = Number(record.durationSec) || 0;
    const fromRecord = Number(record.estCaloriesKcal);
    const estCaloriesKcal = Number.isFinite(fromRecord) && fromRecord > 0
      ? Math.round(fromRecord)
      : Math.round(estimateWorkoutCaloriesKcal(distanceM, durationSec));
    return {
      id: record.id || Date.now().toString(),
      startedAt: record.startedAt || null,
      finishedAt: record.finishedAt || null,
      durationSec,
      distanceM,
      avgPaceSecPerKm: Number(record.avgPaceSecPerKm) || 0,
      estCaloriesKcal,
      mode: record.mode || null,
      plannedRouteId: record.plannedRouteId || null,
      activityId: record.activityId || null,
      // Тяжелый geojson оставляем только как есть, если он есть в записи;
      // в persist-снимке ниже будем хранить его только у последних сессий.
      geojson: record.geojson || null
    };
  }

  buildPersistentSnapshot() {
    const result = {};
    const userEntries = Object.entries(this.userData || {});

    for (const [chatId, user] of userEntries) {
      if (!user || typeof user !== 'object') continue;

      const historyRaw = Array.isArray(user.history) ? user.history : [];
      const historyDedupMap = new Map();
      for (const item of historyRaw) {
        if (!item || typeof item !== 'object') continue;
        const routeId = item.routeId || '';
        const timestamp = item.timestamp || '';
        const uniqueKey = `${routeId}|${timestamp}`;
        historyDedupMap.set(uniqueKey, {
          routeName: item.routeName || 'Маршрут',
          routeId: item.routeId || null,
          date: item.date || null,
          completed: item.completed !== false,
          timestamp: item.timestamp || new Date().toISOString()
        });
      }
      const history = Array.from(historyDedupMap.values())
        .map((item) => ({
          routeName: item.routeName || 'Маршрут',
          routeId: item.routeId || null,
          activityId: item.activityId || null,
          sourceSessionId: item.sourceSessionId || null,
          date: item.date || null,
          completed: item.completed !== false,
          timestamp: item.timestamp || new Date().toISOString()
        }))
        .slice(-100);

      const sessionsRaw = Array.isArray(user.sessions) ? user.sessions : [];
      const sessionsSanitized = sessionsRaw
        .map((s) => this.sanitizeSessionRecord(s))
        .filter(Boolean)
        .slice(-300);
      const keepGeojsonFrom = Math.max(0, sessionsSanitized.length - 20);
      const sessions = sessionsSanitized.map((s, idx) => {
        if (idx < keepGeojsonFrom) {
          return { ...s, geojson: null };
        }
        return s;
      });

      result[String(chatId)] = {
        chatId: String(chatId),
        // Оставляем только полезные для продукта поля.
        history,
        sessions,
        totalDistanceM: Number(user.totalDistanceM) || 0,
        totalDurationSec: Number(user.totalDurationSec) || 0,
        totalSessions: Number(user.totalSessions) || 0,
        lastLocation: user.lastLocation || null,
        hasSeenWelcome: Boolean(user.hasSeenWelcome),
        createdAt: user.createdAt || new Date().toISOString(),
        lastUpdated: user.lastUpdated || new Date().toISOString()
      };
    }

    return result;
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
      const snapshot = this.buildPersistentSnapshot();
      const data = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(this.dataFile, data, 'utf8');
      console.log(`💾 Сохранены данные для ${Object.keys(snapshot).length} пользователей`);
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
        totalDistanceM: 0,
        totalDurationSec: 0,
        totalSessions: 0,
        lastLocation: null,
        hasSeenWelcome: false,
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
    if (typeof u.totalDistanceM !== 'number') u.totalDistanceM = 0;
    if (typeof u.totalDurationSec !== 'number') u.totalDurationSec = 0;
    if (typeof u.totalSessions !== 'number') u.totalSessions = 0;
    if (!('lastLocation' in u)) u.lastLocation = null;
    if (!('hasSeenWelcome' in u)) u.hasSeenWelcome = false;
    if (!u.createdAt) u.createdAt = new Date().toISOString();
    if (!u.lastUpdated) u.lastUpdated = new Date().toISOString();
    if (!('locationShareIntent' in u)) u.locationShareIntent = null;
    if (!('nearbyPendingActivityId' in u)) u.nearbyPendingActivityId = null;
    if (!('nearbyActivityId' in u)) u.nearbyActivityId = null;

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

  addRouteToHistory(chatId, routeName, routeId, extra = {}) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    const nowIso = new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    const lastEntry = Array.isArray(session.history) && session.history.length
      ? session.history[session.history.length - 1]
      : null;
    if (lastEntry && lastEntry.routeId === routeId) {
      const lastTsMs = Date.parse(lastEntry.timestamp || '');
      if (Number.isFinite(lastTsMs) && nowMs - lastTsMs <= 15000) {
        // Защита от дублей: один и тот же маршрут, записанный повторно сразу после предыдущей записи.
        return;
      }
    }

    const historyEntry = {
      routeName: routeName,
      routeId: routeId,
      activityId: typeof extra.activityId === 'string' && extra.activityId.length > 0 ? extra.activityId : null,
      sourceSessionId:
        typeof extra.sourceSessionId === 'string' && extra.sourceSessionId.length > 0
          ? extra.sourceSessionId
          : null,
      date: new Date().toLocaleString(),
      completed: true,
      timestamp: nowIso
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
    session.totalDistanceM += Number(record.distanceM) || 0;
    session.totalDurationSec += Number(record.durationSec) || 0;
    session.totalSessions += 1;

    if (session.sessions.length > 500) {
      session.sessions = session.sessions.slice(-500);
    }

    session.lastUpdated = new Date().toISOString();
    this.saveData();

    return record;
  }

  removeSessionById(chatId, sessionId) {
    const session = this.getUserSession(chatId);
    if (!Array.isArray(session.sessions) || !session.sessions.length) return false;
    const beforeLen = session.sessions.length;
    session.sessions = session.sessions.filter((s) => String(s?.id || '') !== String(sessionId));
    const removed = session.sessions.length !== beforeLen;
    if (!removed) return false;
    // По договоренности продукта lifetime-метрики архивные: удаление из истории их не меняет.
    session.lastUpdated = new Date().toISOString();
    this.saveData();
    return true;
  }

  getLifetimeStats(chatId) {
    const session = this.getUserSession(chatId);
    return {
      totalDistanceM: Number(session.totalDistanceM) || 0,
      totalDurationSec: Number(session.totalDurationSec) || 0,
      totalSessions: Number(session.totalSessions) || 0
    };
  }

  /** Суммарная статистика только по тренировкам с указанным activityId */
  getLifetimeStatsByActivity(chatId, activityId) {
    const sessions = this.getUserSession(chatId).sessions || [];
    let totalDistanceM = 0;
    let totalDurationSec = 0;
    let totalSessions = 0;
    for (const s of sessions) {
      if (s && s.activityId === activityId) {
        totalDistanceM += Number(s.distanceM) || 0;
        totalDurationSec += Number(s.durationSec) || 0;
        totalSessions += 1;
      }
    }
    return { totalDistanceM, totalDurationSec, totalSessions };
  }

  getSessions(chatId, limit = null) {
    const session = this.getUserSession(chatId);
    const sessions = Array.isArray(session.sessions) ? session.sessions : [];
    if (limit && sessions.length > limit) {
      return sessions.slice(-limit);
    }
    return sessions;
  }

  getSessionsByActivity(chatId, activityId, limit = 50) {
    const sessions = this.getUserSession(chatId).sessions || [];
    const filtered = sessions.filter((s) => s && s.activityId === activityId);
    if (limit && filtered.length > limit) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

}

module.exports = UserService;