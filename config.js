// config.js

require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MINI_APP_AUTH_SECRET: process.env.MINI_APP_AUTH_SECRET,
  USER_DATA_FILE: 'data/user_data.json',
  MAX_HISTORY: 50,
  MINI_APP_URL:
    process.env.MINI_APP_URL || 'https://shcmikhael.fvds.ru/mini-app/index.html'
};