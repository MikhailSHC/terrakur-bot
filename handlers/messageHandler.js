const keyboards = require('../keyboards/buttons');

class MessageHandler {
    constructor(bot, userService, routeService, commandHandler) {
        this.bot = bot;
        this.userService = userService;
        this.routeService = routeService;
        this.commandHandler = commandHandler;
    }

    // Главный обработчик текстовых сообщений
    async handleTextMessage(chatId, messageText) {
        const session = this.userService.getUserSession(chatId);
        
        // ========== ОБРАБОТКА КНОПОК ГЛАВНОГО МЕНЮ ==========
        
        if (messageText === '🔍 Найти маршруты') {
            await this.bot.api.sendMessageToChat(chatId, 'Выберите город:', {
                attachments: [keyboards.locationKeyboard]
            });
            return;
        }
        
        if (messageText === '📍 Маршруты рядом со мной') {
            await this.bot.api.sendMessageToChat(
                chatId,
                'Сначала выберите вид активности — затем при необходимости поделитесь геолокацией (как в главном меню по кнопке «Рядом со мной»):',
                { attachments: [keyboards.nearbyActivityPickKeyboard] }
            );
            return;
        }
        
        if (messageText === '📊 Моя история') {
            await this.commandHandler.handleProfile(chatId);
            return;
        }
        
        if (messageText === '❓ Помощь') {
            await this.commandHandler.handleHelp(chatId);
            return;
        }
        
        if (messageText === '🏠 Main menu' || messageText === '🏠 Главное меню') {
            await this.commandHandler.handleStart(chatId);
            return;
        }
        
        // ========== ОБРАБОТКА В ЗАВИСИМОСТИ ОТ СОСТОЯНИЯ ==========
        
        if (session.state === 'start') {
            await this.handleLocationSelection(chatId, messageText);
        } 
        else if (session.state === 'location_selected') {
            await this.handleActivitySelection(chatId, messageText);
        }
        else if (session.state === 'routes_shown') {
            await this.handleRouteSelection(chatId, messageText);
        }
        else if (messageText.startsWith('✅ START ')) {
            await this.handleStartRoute(chatId, messageText);
        }
        else {
            await this.bot.api.sendMessageToChat(
                chatId,
                '🌲 Добро пожаловать!',
                { attachments: [keyboards.mainMenuKeyboard] }
            );
        }
    }

    // Выбор города
    async handleLocationSelection(chatId, messageText) {
        let location = null;
        
        if (messageText === 'Ставрополь' || messageText === 'Stavropol') {
            location = this.routeService.getLocationById('stavropol');
        } else if (messageText === 'КавМинВоды' || messageText === 'KavMinVody') {
            location = this.routeService.getLocationById('kavminvody');
        } else if (messageText === 'Кисловодск' || messageText === 'Kislovodsk') {
            location = this.routeService.getLocationById('kislovodsk');
        } else if (messageText === 'Пятигорск' || messageText === 'Pyatigorsk') {
            location = this.routeService.getLocationById('pyatigorsk');
        }
        
        if (location) {
            this.userService.setUserState(chatId, 'location_selected', {
                selectedLocation: location
            });
            
            await this.bot.api.sendMessageToChat(
                chatId,
                `✅ Отлично! Вы выбрали ${location.name}. Теперь выберите активность:`,
                { attachments: [keyboards.activityKeyboard] }
            );
        } else {
            await this.bot.api.sendMessageToChat(
                chatId,
                '❌ Пожалуйста, выберите город из кнопок:',
                { attachments: [keyboards.locationKeyboard] }
            );
        }
    }

    // Выбор активности
    async handleActivitySelection(chatId, messageText) {
        const session = this.userService.getUserSession(chatId);
        const location = session.selectedLocation;
        
        if (!location) {
            await this.commandHandler.handleStart(chatId);
            return;
        }
        
        if (messageText === '⬅️ Back to locations') {
            await this.bot.api.sendMessageToChat(
                chatId,
                'Выберите город:',
                { attachments: [keyboards.locationKeyboard] }
            );
            return;
        }
        
        let activity = null;
        if (messageText === '🚶 Walking') {
            activity = this.routeService.getActivityById('walking');
        } else if (messageText === '🏃 Running') {
            activity = this.routeService.getActivityById('running');
        } else if (messageText === '🥾 Nordic Walking') {
            activity = this.routeService.getActivityById('nordic_walking');
        } else if (messageText === '🚲 Cycling') {
            activity = this.routeService.getActivityById('cycling');
        }
        
        if (activity && location) {
            await this.showRoutes(chatId, location, activity);
        } else {
            await this.bot.api.sendMessageToChat(
                chatId,
                '❌ Пожалуйста, выберите активность из кнопок:',
                { attachments: [keyboards.activityKeyboard] }
            );
        }
    }

    // Показать список маршрутов
    async showRoutes(chatId, location, activity) {
        const routes = this.routeService.getRoutesForLocationAndActivity(location.id, activity.id);
        
        if (routes.length > 0) {
            const { formatRouteList } = require('../utils/helpers');
            
            let text = `📍 Найдено ${routes.length} маршрутов для ${activity.name} в ${location.name}:\n\n`;
            text += formatRouteList(routes.slice(0, 5));
            text += '\nВведите номер маршрута чтобы увидеть детали:';
            
            this.userService.setUserState(chatId, 'routes_shown', {
                availableRoutes: routes,
                selectedActivity: activity
            });
            
            await this.bot.api.sendMessageToChat(
                chatId,
                text,
                { attachments: [keyboards.getRouteKeyboard(routes)] }
            );
        } else {
            await this.bot.api.sendMessageToChat(
                chatId,
                `❌ Нет маршрутов для ${activity.name} в ${location.name}. Попробуйте другую активность.`
            );
        }
    }

    // Выбор маршрута по номеру
    async handleRouteSelection(chatId, messageText) {
        const session = this.userService.getUserSession(chatId);
        const routes = session.availableRoutes || [];
        const location = session.selectedLocation;
        
        if (messageText === '⬅️ Back to activities' && location) {
            await this.bot.api.sendMessageToChat(
                chatId,
                `Выберите активность для ${location.name}:`,
                { attachments: [keyboards.activityKeyboard] }
            );
            return;
        }
        
        if (messageText === '🏠 Main menu') {
            await this.commandHandler.handleStart(chatId);
            return;
        }
        
        const routeIndex = parseInt(messageText) - 1;
        if (!isNaN(routeIndex) && routeIndex >= 0 && routeIndex < routes.length) {
            const route = routes[routeIndex];
            await this.showRouteDetails(chatId, route);
        } else {
            await this.bot.api.sendMessageToChat(
                chatId,
                '❌ Неверный номер. Пожалуйста, выберите номер из кнопок.'
            );
        }
    }

    // Показать детали маршрута
    async showRouteDetails(chatId, route) {
        const { formatRouteDetails } = require('../utils/helpers');
        const details = formatRouteDetails(route);
        
        await this.bot.api.sendMessageToChat(
            chatId,
            details,
            { attachments: [keyboards.getRouteDetailKeyboard(route.id)] }
        );
    }

    // Начать маршрут
    async handleStartRoute(chatId, messageText) {
        const routeId = messageText.replace('✅ START ', '');
        const route = this.routeService.findRouteById(routeId);
        
        if (route) {
            this.userService.addRouteToHistory(chatId, route.name, routeId);
            
            await this.bot.api.sendMessageToChat(
                chatId,
                `✅ Маршрут *${route.name}* начат!\n\n` +
                `Желаем удачи! Ваш прогресс сохранен.\n\n` +
                `Используйте /profile чтобы увидеть историю.\n\n` +
                `Используйте /start чтобы найти другие маршруты!`,
                { parse_mode: 'Markdown' }
            );
            
            await this.commandHandler.handleStart(chatId);
        } else {
            await this.bot.api.sendMessageToChat(
                chatId,
                '❌ Маршрут не найден. Попробуйте еще раз.'
            );
        }
    }
}

module.exports = MessageHandler;