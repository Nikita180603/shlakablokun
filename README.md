# Каменный двор

## 1. Скопировать на сервер

```bash
scp -r ./plitka_i_shlakablokyn user@SERVER_IP:~/plitka
cd ~/plitka
cp .env.example .env
```

В `.env` указать `KD_DOMAIN`, логин и пароль админки.

## 2. Сбилдить бинарник (на машине, где есть Go)

Linux-сервер:

```bash
CGO_ENABLED=0 go build -o kd-server ./cmd/server
```

С Windows под Linux-сервер:

```powershell
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -o kd-server ./cmd/server
scp .\kd-server user@SERVER_IP:~/plitka/
```

## 3. Запустить просто

```bash
./kd-server
```

Сайт: http://127.0.0.1:4173/

## 4. Запустить в Docker

Сначала нужен файл `kd-server` в корне проекта (п. 2).

```bash
docker compose up -d --build app
```

Сайт: http://127.0.0.1:4173/

С HTTPS (DNS + порты 80/443):

```bash
docker compose up -d --build
```

## 5. Добавление товаров

В админке откройте «Товары» → «Добавить товар». Заполните название, раздел, цену и единицу; цвета укажите по одному в строке, при желании с кодом: `Серый #8d8d86`.

Новые позиции сохраняются в `data/admin.js` и сразу появляются в каталоге. Фото загружается там же и хранится в `img/custom/` — эта папка подключена к контейнеру отдельным томом, поэтому снимки не пропадают при пересборке. Если фото нет, на витрине показывается заглушка.

Удалить можно только добавленный товар. Позиции из `js/data.js` вместо удаления скрываются галочкой «Скрыть с витрины».

## 6. Резервное копирование

- Windows: `powershell -File deploy/backup.ps1`, ежедневный запуск — `deploy/setup-backup-task.ps1`.
- Linux/systemd: `deploy/kamenniy-dvor-backup.service` и `deploy/kamenniy-dvor-backup.timer`.
- Копируются `data/shop.db` (заказы, заявки, настройки) и `img/custom/` (фото товаров). Бэкапы старше 14 дней удаляются.
