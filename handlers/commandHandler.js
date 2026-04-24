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
        // Предпочтительный режим: статическая ссылка для запуска через MAX.
        // Персонализация берётся на бэкенде после валидации MAX initData.
        const useMaxInitDataMode = this.config?.USE_MAX_INITDATA_LINKS !== '0';
        if (useMaxInitDataMode) {
            baseUrl.search = '';
            return baseUrl.toString();
        }

        // Режим совместимости (сохранен для быстрого отката).
        // Если есть проблемы с MAX initData, выставьте USE_MAX_INITDATA_LINKS=0.
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
        const sessionBefore = this.userService.getUserSession(chatId);
        const isFirstVisit = !sessionBefore?.hasSeenWelcome;

        this.userService.setUserState(chatId, 'start', {
            hasSeenWelcome: true
        });

        if (withGreeting || isFirstVisit) {
            await this.bot.api.sendMessageToChat(
                chatId,
                '🌿 Добро пожаловать в LiveTrack — Живая Тропа!\n\n' +
                'Помогу выбрать готовый маршрут, построить свой трек и сохранить тренировку в истории.\n\n' +
                'Ниже — главное меню. Выберите, с чего хотите начать.',
                { parse_mode: 'Markdown' }
            );
        }

        if (isFirstVisit) {
            await this.bot.api.sendMessageToChat(
                chatId,
                '👋 Вы здесь впервые. Откройте «❓ Помощь»: там короткий старт-гайд, советы по геолокации и ответы на частые вопросы.'
            );
        }

        await this.bot.api.sendMessageToChat(chatId, 'Главное меню:', {
            attachments: [keyboards.getMainMenuKeyboard(this.buildHistoryMiniAppUrl(chatId))]
        });
    }

    async handleHelp(chatId) {
        const helpText =
            '❓ Как пользоваться ботом LiveTrack — Живая Тропа\n\n' +
            '1) «🧭 Построить маршрут» — свободная тренировка на карте.\n' +
            '2) «📋 Маршруты Ставрополья» — готовые маршруты по городам.\n' +
            '3) «📍 Рядом со мной» — ближайшие маршруты по вашей геолокации.\n' +
            '4) Мини-приложение: здесь доступны статистика, история и настройки профиля/геолокации.\n\n' +
            'Команды:\n' +
            '/start — главное меню\n' +
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
                '🗺️ Для этого вида активности пока нет завершённых маршрутов (выше показаны только тренировки трекера).';
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