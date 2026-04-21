const keyboards = require('../keyboards/buttons');
const { createMiniAppToken } = require('../utils/miniAppAuth');

class CommandHandler {
    constructor(bot, userService, routeService, config) {
        this.bot = bot;
        this.userService = userService;
        this.routeService = routeService;
        this.config = config;
    }

    buildHistoryMiniAppUrl(chatId) {
        const baseUrl = new URL(this.config.MINI_APP_URL);
        if (baseUrl.pathname.endsWith('/index.html')) {
            baseUrl.pathname = baseUrl.pathname.replace(/\/index\.html$/, '/history.html');
        }

        const params = new URLSearchParams({
            chatId: String(chatId),
            screen: 'history'
        });
        if (this.config?.MINI_APP_AUTH_SECRET) {
            params.set('authToken', createMiniAppToken(chatId, this.config.MINI_APP_AUTH_SECRET));
        }
        baseUrl.search = params.toString();
        return baseUrl.toString();
    }

    async handleStart(chatId, options = {}) {
        const { withGreeting = false } = options;

        this.userService.setUserState(chatId, 'start', {
            hasSeenWelcome: true
        });

        if (withGreeting) {
            await this.bot.api.sendMessageToChat(
                chatId,
                '🌿 Добро пожаловать в ЗОЖ-маршруты и тропы Ставрополья!\n\n' +
                'Здесь вы сможете выбрать маршрут по городу, найти тропы рядом с вами и сохранить свои тренировки в истории.\n\n' +
                'Рад быть вашим проводником к активному отдыху 💚',
                { parse_mode: 'Markdown' }
            );
        }

        await this.bot.api.sendMessageToChat(chatId, 'Главное меню:', {
            attachments: [keyboards.getMainMenuKeyboard(this.buildHistoryMiniAppUrl(chatId))]
        });
    }

    async handleHelp(chatId) {
        const helpText = 
            '❓ Как пользоваться ботом TerraKur\n\n' +
            '1) Откройте Маршруты Ставрополья и выберите город + активность.\n' +
            '2) Или нажмите Рядом со мной — бот подберёт ближайшие тропы по вашей геолокации.\n' +
            '3) Нажмите Старт у маршрута и откройте карту.\n' +
            '4) После тренировки прогресс и статистика появятся в Моя история.\n\n' +
            'Команды:\n' +
            '/start — главное меню\n' +
            '/profile — история и статистика\n' +
            '/help — эта справка';

        await this.bot.api.sendMessageToChat(chatId, helpText, {
            parse_mode: 'Markdown',
            attachments: [keyboards.getMainMenuKeyboard(this.buildHistoryMiniAppUrl(chatId))]
        });
    }

    async sendProfileActivityPicker(chatId) {
        await this.bot.api.sendMessageToChat(
            chatId,
            '📊 Моя история\n\nВыберите вид активности — покажу тренировки и завершённые маршруты только для него. Или «все виды» для общей сводки.',
            {
                parse_mode: 'Markdown',
                attachments: [keyboards.profileActivityPickKeyboard]
            }
        );
    }

    async handleProfile(chatId) {
        await this.sendProfileActivityPicker(chatId);
    }

    /**
     * @param {string|null} activityId — null = все виды
     */
    async handleProfileForActivity(chatId, activityId) {
        const session = this.userService.getUserSession(chatId);
        const historyAll = session.history || [];

        let lifetime;
        let titleScope;
        if (activityId == null) {
            lifetime = this.userService.getLifetimeStats(chatId);
            titleScope = '📊 Все виды активности';
        } else {
            lifetime = this.userService.getLifetimeStatsByActivity(chatId, activityId);
            const act = this.routeService.getActivityById(activityId);
            const actLabel = act ? `${act.emoji} ${act.name}` : activityId;
            titleScope = `📊 ${actLabel}`;
        }

        const totalKm = (lifetime.totalDistanceM / 1000).toFixed(2);
        const totalHours = Math.floor(lifetime.totalDurationSec / 3600);
        const totalMinutes = Math.floor((lifetime.totalDurationSec % 3600) / 60);
        const lifetimeHeader =
            `${titleScope}\n\n` +
            `🏁 Тренировки (трекер):\n` +
            `• Дистанция: ${totalKm} км\n` +
            `• Время: ${totalHours} ч ${totalMinutes} мин\n` +
            `• Сессий: ${lifetime.totalSessions}\n\n`;

        let historySlice = historyAll;
        if (activityId != null) {
            historySlice = historyAll.filter((h) => {
                const r = this.routeService.findRouteById(h.routeId);
                return r && Array.isArray(r.activities) && r.activities.includes(activityId);
            });
        }

        let profileText = lifetimeHeader;

        if (lifetime.totalSessions === 0 && historySlice.length === 0) {
            profileText +=
                '📝 Пока нет тренировок с этим видом активности в трекере и нет завершённых маршрутов в истории.';
            await this.bot.api.sendMessageToChat(chatId, profileText, {
                parse_mode: 'Markdown',
                attachments: [keyboards.profileActivityResultKeyboard]
            });
            return;
        }

        if (historySlice.length === 0) {
            profileText +=
                '🗺️ В истории завершённых маршрутов для этого вида пока пусто (есть только записи трекера выше).';
            await this.bot.api.sendMessageToChat(chatId, profileText, {
                parse_mode: 'Markdown',
                attachments: [keyboards.profileActivityResultKeyboard]
            });
            return;
        }

        profileText += 'Завершённые маршруты (последние 5):\n\n';
        historySlice
            .slice(-5)
            .reverse()
            .forEach((record, index) => {
                profileText += `${index + 1}. ${record.routeName}\n`;
                profileText += `   📅 ${record.date}\n\n`;
            });
        await this.bot.api.sendMessageToChat(chatId, profileText, {
            parse_mode: 'Markdown',
            attachments: [keyboards.profileActivityResultKeyboard]
        });
    }

    async handleUnknownCommand(chatId) {
        await this.bot.api.sendMessageToChat(
            chatId,
            '❓ Неизвестная команда. Используйте /start для начала или /help для списка команд.'
        );
    }
}

module.exports = CommandHandler;