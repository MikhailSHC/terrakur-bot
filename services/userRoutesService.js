// services/userRoutesService.js
const fs = require('fs');
const path = require('path');
const config = require('../config');

class UserRoutesService {
  constructor() {
    this.dataFile = path.join(__dirname, '..', config.USER_DATA_FILE);
  }

  loadAllUsers() {
    if (!fs.existsSync(this.dataFile)) return {};
    try {
      const raw = fs.readFileSync(this.dataFile, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('❌ Ошибка чтения user_data.json в UserRoutesService:', e.message);
      return {};
    }
  }

  getUserRoutes(chatId) {
    const allUsers = this.loadAllUsers();
    const user = allUsers[String(chatId)] || {};
    return Array.isArray(user.userRoutes) ? user.userRoutes : [];
  }
}

module.exports = UserRoutesService;