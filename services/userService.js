const fs = require('fs');
const path = require('path');
const config = require('../config');

class UserService {
    constructor() {
        // Путь к файлу с данными пользователей
        this.dataFile = path.join(__dirname, '..', config.USER_DATA_FILE);
        this.userData = {};
        this.loadData();
    }

    /**
     * Загрузка данных из файла при запуске бота
     */
    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const rawData = fs.readFileSync(this.dataFile, 'utf8');
                this.userData = JSON.parse(rawData);
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

    /**
     * Сохранение данных в файл
     * Используется синхронная запись для простоты, в продакшене лучше использовать async
     */
    saveData() {
        try {
            const data = JSON.stringify(this.userData, null, 2);
            fs.writeFileSync(this.dataFile, data, 'utf8');
            console.log(`💾 Сохранены данные для ${Object.keys(this.userData).length} пользователей`);
        } catch (error) {
            console.error('❌ Ошибка сохранения данных пользователей:', error.message);
        }
    }

    /**
     * Получить или создать сессию пользователя по chatId
     * @param {number|string} chatId - уникальный идентификатор чата/пользователя
     * @returns {Object} - объект с данными пользователя
     */
    getUserSession(chatId) {
        const id = String(chatId);
        
        // Если пользователь не найден - создаем новую запись
        if (!this.userData[id]) {
            this.userData[id] = {
                chatId: id,
                state: 'start',
                selectedLocation: null,
                selectedActivity: null,
                availableRoutes: [],
                history: [],
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };
            console.log(`👤 Создан новый пользователь: ${id}`);
            this.saveData();
        }
        
        return this.userData[id];
    }

    /**
     * Обновить состояние пользователя
     * @param {number|string} chatId - ID пользователя
     * @param {string} state - новое состояние
     * @param {Object} extraData - дополнительные данные для сохранения
     */
    setUserState(chatId, state, extraData = {}) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        
        session.state = state;
        session.lastUpdated = new Date().toISOString();
        
        // Обновляем дополнительные поля, если они переданы
        Object.keys(extraData).forEach(key => {
            if (extraData[key] !== undefined) {
                session[key] = extraData[key];
            }
        });
        
        this.saveData();
        console.log(`🔄 Обновлено состояние пользователя ${id}: ${state}`);
    }

    /**
     * Добавить маршрут в историю пользователя
     * @param {number|string} chatId - ID пользователя
     * @param {string} routeName - название маршрута
     * @param {string} routeId - ID маршрута
     */
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
        
        // Оставляем только последние 50 записей (чтобы файл не раздувался)
        if (session.history.length > 50) {
            session.history = session.history.slice(-50);
        }
        
        session.lastUpdated = new Date().toISOString();
        this.saveData();
        
        console.log(`📝 Добавлен маршрут "${routeName}" для пользователя ${id}`);
    }

    /**
     * Получить историю пользователя
     * @param {number|string} chatId - ID пользователя
     * @param {number} limit - количество последних записей
     * @returns {Array} - массив с историей
     */
    getUserHistory(chatId, limit = 5) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        return session.history.slice(-limit);
    }

    /**
     * Получить текущее состояние пользователя
     * @param {number|string} chatId - ID пользователя
     * @returns {string} - текущее состояние
     */
    getUserState(chatId) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        return session.state;
    }

    /**
     * Получить выбранный город пользователя
     * @param {number|string} chatId - ID пользователя
     * @returns {Object|null} - объект города или null
     */
    getUserSelectedLocation(chatId) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        return session.selectedLocation;
    }

    /**
     * Получить выбранную активность пользователя
     * @param {number|string} chatId - ID пользователя
     * @returns {Object|null} - объект активности или null
     */
    getUserSelectedActivity(chatId) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        return session.selectedActivity;
    }

    /**
     * Получить доступные маршруты для пользователя
     * @param {number|string} chatId - ID пользователя
     * @returns {Array} - массив маршрутов
     */
    getUserAvailableRoutes(chatId) {
        const id = String(chatId);
        const session = this.getUserSession(id);
        return session.availableRoutes || [];
    }

    /**
     * Очистить данные пользователя (для тестирования)
     * @param {number|string} chatId - ID пользователя
     */
    clearUserData(chatId) {
        const id = String(chatId);
        if (this.userData[id]) {
            delete this.userData[id];
            this.saveData();
            console.log(`🗑️ Удалены данные пользователя ${id}`);
        }
    }

    /**
     * Получить общую статистику по всем пользователям
     * @returns {Object} - статистика
     */
    getStatistics() {
        const totalUsers = Object.keys(this.userData).length;
        let totalCompletedRoutes = 0;
        
        Object.values(this.userData).forEach(user => {
            totalCompletedRoutes += user.history.length;
        });
        
        return {
            totalUsers: totalUsers,
            totalCompletedRoutes: totalCompletedRoutes,
            activeUsers: Object.values(this.userData).filter(u => {
                const lastDay = new Date();
                lastDay.setDate(lastDay.getDate() - 1);
                return new Date(u.lastUpdated) > lastDay;
            }).length
        };
    }
}

module.exports = UserService;