const fs = require('fs');
const path = require('path');
const config = require('../config');
const { estimateWorkoutCaloriesKcal } = require('../utils/estimateCalories');
const { createLogger } = require('../utils/logger');

const logger = createLogger('user-service');

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
      // Keep geojson only for recent sessions to avoid bloating user_data.json.
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
        // Persist only fields required by runtime and analytics.
        history,
        sessions,
        fullName: typeof user.fullName === 'string' ? user.fullName : '',
        weightKg: Number.isFinite(Number(user.weightKg)) ? Number(user.weightKg) : null,
        age: Number.isFinite(Number(user.age)) ? Number(user.age) : null,
        heightCm: Number.isFinite(Number(user.heightCm)) ? Math.round(Number(user.heightCm)) : null,
        sex: user.sex === 'male' || user.sex === 'female' ? user.sex : null,
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
        logger.info('User data loaded', { users: Object.keys(this.userData).length });
      } else {
        logger.warn('User data file is missing, new snapshot will be created');
        this.userData = {};
      }
    } catch (error) {
      logger.error('Failed to load user data', { error: error.message });
      this.userData = {};
    }
  }

  saveData() {
    try {
      const snapshot = this.buildPersistentSnapshot();
      const data = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(this.dataFile, data, 'utf8');
      logger.info('User data saved', { users: Object.keys(snapshot).length });
    } catch (error) {
      logger.error('Failed to save user data', { error: error.message });
      throw new Error('Не удалось сохранить данные пользователя');
    }
  }

  // Returns normalized user record with all required fields.
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
        fullName: '',
        weightKg: null,
        age: null,
        heightCm: null,
        sex: null,
        totalDistanceM: 0,
        totalDurationSec: 0,
        totalSessions: 0,
        lastLocation: null,
        hasSeenWelcome: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      logger.info('User created', { chatId: id });
      this.saveData();
      return this.userData[id];
    }

    const u = this.userData[id];

    // Schema guard for old snapshots and partially filled records.
    if (!Array.isArray(u.history)) u.history = [];
    if (!Array.isArray(u.sessions)) u.sessions = [];
    if (typeof u.totalDistanceM !== 'number') u.totalDistanceM = 0;
    if (typeof u.totalDurationSec !== 'number') u.totalDurationSec = 0;
    if (typeof u.totalSessions !== 'number') u.totalSessions = 0;
    if (!('fullName' in u)) u.fullName = '';
    if (!('weightKg' in u)) u.weightKg = null;
    if (!('age' in u)) u.age = null;
    if (!('heightCm' in u)) u.heightCm = null;
    if (!('sex' in u)) u.sex = null;
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
    logger.info('State updated', { chatId: id, state });
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
        // Deduplicate accidental double-save of the same route in short interval.
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

    logger.info('Route added to history', { chatId: id, routeName, routeId });
  }

  getUserHistory(chatId, limit = 5) {
    const id = String(chatId);
    const session = this.getUserSession(id);
    return session.history.slice(-limit);
  }

  removeHistoryEntry(chatId, routeId, timestamp) {
    const session = this.getUserSession(chatId);
    if (!Array.isArray(session.history) || !session.history.length) return false;
    const beforeLen = session.history.length;
    session.history = session.history.filter((item) => {
      const sameRoute = String(item?.routeId || '') === String(routeId || '');
      const sameTimestamp = String(item?.timestamp || '') === String(timestamp || '');
      return !(sameRoute && sameTimestamp);
    });
    const removed = session.history.length !== beforeLen;
    if (!removed) return false;
    session.lastUpdated = new Date().toISOString();
    this.saveData();
    return true;
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
      logger.warn('User data removed', { chatId: id });
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

  setLastLocation(chatId, lastLocation) {
    const session = this.getUserSession(chatId);
    session.lastLocation = lastLocation;
    session.lastUpdated = new Date().toISOString();
    this.saveData();
  }

  getUserProfile(chatId) {
    const session = this.getUserSession(chatId);
    return {
      fullName: typeof session.fullName === 'string' ? session.fullName : '',
      weightKg: Number.isFinite(Number(session.weightKg)) ? Number(session.weightKg) : null,
      age: Number.isFinite(Number(session.age)) ? Number(session.age) : null,
      heightCm: Number.isFinite(Number(session.heightCm)) ? Math.round(Number(session.heightCm)) : null,
      sex: session.sex === 'male' || session.sex === 'female' ? session.sex : null,
      hasLocation: Boolean(
        session.lastLocation &&
        Number.isFinite(Number(session.lastLocation.latitude)) &&
        Number.isFinite(Number(session.lastLocation.longitude))
      )
    };
  }

  updateUserProfile(chatId, profilePatch = {}) {
    const session = this.getUserSession(chatId);
    let changed = false;
    if (typeof profilePatch.fullName === 'string') {
      const next = profilePatch.fullName.trim();
      if (next !== (session.fullName || '')) {
        session.fullName = next;
        changed = true;
      }
    }
    if (profilePatch.weightKg !== undefined) {
      const n = Number(profilePatch.weightKg);
      const next = Number.isFinite(n) && n > 0 ? n : null;
      if (next !== session.weightKg) {
        session.weightKg = next;
        changed = true;
      }
    }
    if (profilePatch.age !== undefined) {
      const n = Number(profilePatch.age);
      const next = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      if (next !== session.age) {
        session.age = next;
        changed = true;
      }
    }
    if (profilePatch.heightCm !== undefined) {
      const n = Number(profilePatch.heightCm);
      const next = Number.isFinite(n) && n >= 50 && n <= 290 ? Math.round(n) : null;
      if (next !== session.heightCm) {
        session.heightCm = next;
        changed = true;
      }
    }
    if (profilePatch.sex !== undefined) {
      const normalized = String(profilePatch.sex || '').toLowerCase();
      const next = normalized === 'male' || normalized === 'female' ? normalized : null;
      if (next !== session.sex) {
        session.sex = next;
        changed = true;
      }
    }
    if (changed) {
      session.lastUpdated = new Date().toISOString();
      this.saveData();
    }
    return this.getUserProfile(chatId);
  }

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
    // Product rule: deleting one session does not rewrite lifetime aggregates.
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