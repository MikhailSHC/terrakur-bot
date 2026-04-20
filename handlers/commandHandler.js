const keyboards = require('../keyboards/buttons');

class CommandHandler {
    constructor(bot, userService) {
        this.bot = bot;
        this.userService = userService;
    }

    async handleStart(chatId) {
        this.userService.setUserState(chatId, 'start');
        
        await this.bot.api.sendMessageToChat(
            chatId,
            '🌲 *Добро пожаловать в TerraKur и ZHIV routes!* 🌲\n\n' +
            'Я помогу найти идеальный маршрут для вашей активности в Ставропольском крае.\n\n' +
            '🏙️ *Выберите действие:*',
            { parse_mode: 'Markdown' }
        );
        
        await this.bot.api.sendMessageToChat(chatId, 'Главное меню:', {
            attachments: [keyboards.mainMenuKeyboard]
        });
    }

    async handleHelp(chatId) {
        const helpText = 
            '📚 *Доступные команды:*\n' +
            '/start - Начать поиск маршрутов\n' +
            '/profile - Моя активность\n' +
            '/help - Помощь\n\n' +
            '✨ *Возможности:*\n' +
            '• Выбор города и активности\n' +
            '• Персональные рекомендации\n' +
            '• История пройденных маршрутов\n\n' +
            'Используйте кнопки для навигации!';
        
        await this.bot.api.sendMessageToChat(chatId, helpText, { parse_mode: 'Markdown' });
    }

    async handleProfile(chatId) {
        const session = this.userService.getUserSession(chatId);
        const history = session.history || [];
        const lifetime = this.userService.getLifetimeStats(chatId);
        const totalKm = (lifetime.totalDistanceM / 1000).toFixed(2);
        const totalHours = Math.floor(lifetime.totalDurationSec / 3600);
        const totalMinutes = Math.floor((lifetime.totalDurationSec % 3600) / 60);
        const lifetimeHeader =
            `🏁 *За всё время:*\n` +
            `• Дистанция: *${totalKm} км*\n` +
            `• Время: *${totalHours} ч ${totalMinutes} мин*\n` +
            `• Тренировок: *${lifetime.totalSessions}*\n\n`;
        
        if (history.length === 0) {
            await this.bot.api.sendMessageToChat(
                chatId,
                lifetimeHeader +
                '📝 У вас пока нет записей в истории маршрутов. Начните с /start!',
                { parse_mode: 'Markdown' }
            );
        } else {
            let profileText = lifetimeHeader + '📊 *Ваша история активности:*\n\n';
            history.slice(-5).reverse().forEach((record, index) => {
                profileText += `${index + 1}. ${record.routeName}\n`;
                profileText += `   📅 ${record.date}\n\n`;
            });
            profileText += 'Используйте /start чтобы найти новые маршруты!';
            
            await this.bot.api.sendMessageToChat(chatId, profileText, { parse_mode: 'Markdown' });
        }
    }

    async handleUnknownCommand(chatId) {
        await this.bot.api.sendMessageToChat(
            chatId,
            '❓ Неизвестная команда. Используйте /start для начала или /help для списка команд.'
        );
    }
}

module.exports = CommandHandler;