# LiveTrack - Живая Тропа

Простой бот для MAX Messenger с мини-приложением: выбор готовых маршрутов, запись тренировок и история активности.

## Что внутри

- Бот (кнопки, сценарии, ответы пользователю)
- API на Express
- Mini-app с картой и трекером

## Быстрый старт

Требования:
- Node.js 20+
- npm 10+

Шаги:
1. Установить зависимости: `npm install`
2. Создать `.env` из примера:  
   Windows: `copy .env.example .env`
3. Заполнить минимум в `.env`:
   - `BOT_TOKEN`
   - `MINI_APP_AUTH_SECRET`
4. Запустить: `npm start`
5. Проверить, что API жив: `GET /api/health`

## Основные переменные `.env`

- `BOT_TOKEN` — токен бота MAX
- `PORT` — порт сервера (по умолчанию `3000`)
- `MINI_APP_URL` — ссылка на mini-app (обычно `.../mini-app/index.html`)
- `MINI_APP_AUTH_SECRET` — секрет для авторизации mini-app
- `MAX_INIT_DATA_SECRET` — секрет для проверки initData MAX
- `DGIS_API_KEY` — ключ 2GIS

Полный список есть в [`.env.example`](.env.example).

## Полезные команды

- `npm start` — запуск бота и API
- `npm run dev` — запуск в dev-режиме
- `npm test` — тесты
- `npm run lint` — проверка кода
- `npm run format` — форматирование
- `npm run build-data` — пересборка `public/mini-app/routes.geojson` из `data/routesData.js`

## Как обновлять маршруты

1. Изменить данные в `data/routesData.js`
2. Выполнить `npm run build-data`
3. Перезапустить сервис

## Деплой (рекомендуемый)

```bash
cd ~/terrakur-bot
git fetch origin
git checkout main
git reset --hard origin/main
npm ci
pm2 restart livetrack-bot
pm2 logs livetrack-bot --lines 30
```

Если нужно убедиться, что стоит последняя версия:

```bash
git rev-parse --short HEAD
git log --oneline -n 3
```

## Структура проекта

- `bot/`, `handlers/`, `keyboards/` — логика бота
- `routes/`, `app/`, `middleware/` — API и middleware
- `services/` — бизнес-логика
- `data/` — маршруты, активности, локации
- `public/mini-app/` — фронтенд mini-app
- `scripts/` — служебные скрипты
- `tests/` — автотесты
