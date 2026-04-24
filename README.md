# LiveTrack - Живая Тропа

Бот для MAX Messenger с мини-приложением для трекинга маршрутов, истории тренировок и статистики.

Проект состоит из:
- бота (диалоговые сценарии и кнопки),
- API на Express (сессии, профиль, маршруты, геокодер),
- mini-app фронтенда (карта, трекер, история, демо).

## 1) Что умеет проект

- Свободная тренировка на карте.
- Выбор готовых маршрутов по городам.
- Подбор маршрутов "Рядом со мной" по геолокации и расстоянию.
- Сохранение тренировок, история и базовая аналитика.
- Генерация и импорт геометрии маршрутов из 2GIS.

## 2) Требования

- Node.js 20+
- npm 10+

## 3) Быстрый старт

1. Установите зависимости:
   - `npm install`
2. Создайте `.env`:
   - Windows: `copy .env.example .env`
3. Заполните минимум:
   - `BOT_TOKEN`
   - `MINI_APP_AUTH_SECRET`
4. Запустите проект:
   - `npm start`
5. Проверьте API:
   - `GET /api/health`

## 4) Переменные окружения

Основные:
- `BOT_TOKEN` — токен бота MAX.
- `PORT` — порт API (по умолчанию `3000`).
- `MINI_APP_AUTH_SECRET` — секрет подписи auth-токена для mini-app.
- `MAX_INIT_DATA_SECRET` — секрет проверки `initData` MAX.

Маршруты и карты:
- `MINI_APP_URL` — URL mini-app (обычно `.../mini-app/index.html`).
- `DGIS_API_KEY` — ключ 2GIS (карта/геокодер/маршруты).

Режимы:
- `NODE_ENV` — `production` или `development`.
- `USE_MAX_INITDATA_LINKS` — режим генерации ссылок mini-app.

Смотрите пример в [`.env.example`](.env.example).

## 5) Команды npm

- `npm start` — запуск бота и API.
- `npm run dev` — запуск в dev-режиме.
- `npm test` — запуск тестов.
- `npm run lint` — проверка ESLint.
- `npm run format` — форматирование Prettier.
- `npm run build-data` — пересборка `public/mini-app/routes.geojson` из `data/routesData.js`.
- `npm run convert-2gis -- "<путь_к_файлу>" [--output "<файл>"]` — конвертация выгрузки 2GIS в плотный `track`.
- `npm run import-2gis-tracks` — пакетный импорт треков из экспортов маршрутов (локальные файлы на Desktop).

## 6) Архитектура и поток данных

Ключевые узлы:
- [index.js](index.js) — точка входа.
- [app/createApp.js](app/createApp.js) — настройка Express.
- [routes/apiRoutes.js](routes/apiRoutes.js) — REST API.
- [bot/registerBotHandlers.js](bot/registerBotHandlers.js) — callback/message обработчики бота.
- [services/userService.js](services/userService.js) — данные пользователя/сессий.
- [services/routeService.js](services/routeService.js) — поиск, фильтрация и сортировка маршрутов.
- [public/mini-app](public/mini-app) — фронтенд мини-приложения.

Поток:
1. Пользователь нажимает кнопку в боте.
2. Бот формирует ссылку/сценарий и передает пользователя в mini-app.
3. Mini-app обращается к API (`/api/...`) с авторизацией.
4. API сохраняет сессию/профиль и возвращает данные для UI.

## 7) Работа с маршрутами

Основной источник:
- [data/routesData.js](data/routesData.js)

Публикуемая геометрия для mini-app:
- [public/mini-app/routes.geojson](public/mini-app/routes.geojson)

Как обновить:
1. Измените/добавьте маршруты в `data/routesData.js`.
2. Выполните `npm run build-data`.

Импорт из 2GIS:
- Для одного файла: `npm run convert-2gis -- "<файл>"`
- Для пакетного обновления: `npm run import-2gis-tracks`

## 8) Безопасность mini-app

Защищенные эндпоинты требуют:
- валидный `chatId`,
- auth-токен mini-app (подписан `MINI_APP_AUTH_SECRET`),
-/или проверенный `initData` MAX (в зависимости от режима).

Токен передается в заголовке `x-miniapp-auth`.

## 9) Структура проекта

- `app/` — сборка и конфигурация Express-приложения.
- `bot/` — регистрация обработчиков событий бота.
- `handlers/` — командные и текстовые обработчики.
- `keyboards/` — описание inline-клавиатур.
- `middleware/` — middleware (например auth mini-app).
- `routes/` — маршруты API.
- `services/` — бизнес-логика (пользователь, маршруты).
- `utils/` — утилиты (логгер, auth, форматтеры, расчеты).
- `data/` — данные маршрутов, активностей, локаций.
- `public/mini-app/` — интерфейс mini-app и статические данные карты.
- `scripts/` — служебные скрипты конвертации/импорта.
- `tests/` — автотесты.
- `docs/` — внутренняя документация и гайды по текстам/UI.

## 10) Диагностика частых проблем

### Бот не реагирует на кнопки
- Проверьте, что запущен актуальный процесс (`npm run dev`/`npm start`).
- Проверьте `BOT_TOKEN`.
- Посмотрите логи callback-обработчика в консоли.

### "Рядом со мной" не показывает маршруты
- Убедитесь, что геолокация сохранена в mini-app (`Моя история` -> `Настройки`).
- Убедитесь, что маршруты имеют статус `active`.

### Mini-app не открывается/ошибка авторизации
- Проверьте `MINI_APP_URL`, `MINI_APP_AUTH_SECRET`, `MAX_INIT_DATA_SECRET`.
- Проверьте, что ссылка на mini-app соответствует окружению.

### Нет карты 2GIS
- Проверьте `DGIS_API_KEY`.
- Убедитесь, что ключ доступен в runtime-конфиге.

### Добавили маршруты, но их нет на карте
- Выполните `npm run build-data`.
- Убедитесь, что обновился `public/mini-app/routes.geojson`.

## 11) Качество и CI

- Тесты: `npm test`
- Линт: `npm run lint`
- Форматирование: `npm run format`

CI в GitHub Actions (`.github/workflows/ci.yml`) запускает линт и тесты на push/PR.
