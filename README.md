# Каменный двор — плитка и шлакоблок

Сайт-каталог тротуарной плитки, шлакоблока и бордюра со склада: каталог, карточки товаров, калькулятор площади, корзина/заказы, админка.

## Стек

- Сервер: Go 1.26 (`cmd/server`), SQLite (`modernc.org/sqlite`).
- Фронтенд: статический HTML/CSS/JS, без сборщика.
- Данные: `data/shop.db` (SQLite, WAL).

## Быстрый старт (локально)

```powershell
go mod download
go run ./cmd/server
```

Откройте http://127.0.0.1:4173/

Или используйте готовый бинарник:

```powershell
.\kd-server.exe
```

Сервер должен запускаться из корня проекта (рядом с `index.html`).

## Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `KD_ADDR` | Адрес прослушивания | `127.0.0.1:4173` |
| `KD_ADMIN_USER` | Логин администратора (создаётся/обновляется при запуске) | генерируется при первом запуске |
| `KD_ADMIN_PASSWORD` | Пароль администратора | генерируется при первом запуске |
| `KD_SMTP_HOST` | SMTP-хост для писем клиентам | — |
| `KD_SMTP_PORT` | SMTP-порт | `587` |
| `KD_SMTP_USER` | SMTP-логин | — |
| `KD_SMTP_PASSWORD` | SMTP-пароль | — |
| `KD_SMTP_FROM` | Адрес отправителя | `KD_SMTP_USER` |

Если `KD_ADMIN_USER`/`KD_ADMIN_PASSWORD` не заданы и учёток нет, сервер один раз сгенерирует пару и выведет её в лог.

## Админка

- URL: http://127.0.0.1:4173/admin/
- Вход по логину/паролю (учётка `admin_user` в БД).
- Управление каталогом, текстами, баннером, фото, лидами и сотрудниками.

## Деплой

### Docker

```bash
docker compose up -d --build
```

Сервис слушает порт `4173` внутри контейнера; для продакшена используйте reverse proxy (Caddy/Nginx) с HTTPS — см. `Caddyfile`.

### systemd (Linux)

```bash
sudo cp deploy/kamenniy-dvor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kamenniy-dvor
```

### Windows-служба

Используйте NSSM или `sc create` (см. `deploy/windows-service.ps1`).

## Мониторинг

- Uptime Kuma доступен на http://127.0.0.1:3001 (или ваш домен).
- Добавьте монитор HTTP(s) на `http://app:4173/healthz` (внутри compose-сети) или `https://ваш-домен/healthz`.
- Настройте уведомления (Telegram/Email) в Uptime Kuma.

База: `data/shop.db` (+ WAL-файлы). Рекомендуется регулярный бэкап:

```powershell
.\deploy\backup.ps1
```

## Лицензия

Проприетарно. Все права защищены.
