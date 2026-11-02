# Orca Docker plugin

Docker Compose в боковой панели Orca и уведомления о падении контейнеров. Плагин работает на публичном API Orca (манифест формата 2, `pluginApi: 1`) без патчей хоста. Нужна Orca 1.4.246 или новее.

## Установка для разработки

```sh
npm install
npm run build        # dist/: orca-plugin.json, panel.html, main.mjs
```

Orca → Settings → Plugins → Development → добавить путь к папке `dist/` и одобрить запрошенные права. То же из терминала: `orca plugin dev load dist`, затем повторить команду с `--approve <fingerprint>` из её вывода.

## Что умеет

**Панель Docker** вводит команды `docker compose …` в выбранный терминал текущего worktree. Сама панель в терминал писать не может, поэтому просит об этом worker через `orca.plugin.request`:

- проект: Start All (`up -d`), Restart, Stop, Down (по второму клику), а также `ps`, Logs, Pull, Build;
- сервис по имени: Start, Restart, Stop, Logs, Shell (`exec <svc> sh`), Rebuild (`up -d --build`);
- опции compose: `-p`, `-f`, `--profile`; галочка «Run immediately», чтобы только вписать команду без Enter.

**Worker** напрямую подключается к Docker Engine API (сокет берётся из текущего `docker context`):

- уведомляет, если контейнер упал сам (не после stop/down), получил OOM или стал unhealthy; при рестарт-лупе — не чаще раза в 10 минут;
- команды в палитре: `Docker: Show Compose Status`, `Docker: Toggle Crash Notifications`.

## Ограничения

- Живого дерева контейнеров и встроенной консоли логов пока нет, логи идут в терминал Orca. Канал панель ↔ worker для них уже есть: `orca.plugin.request` и `orca.panels.post`.
- Панель не знает путь worktree. Команды выполняются в cwd терминала, имена сервисов вводятся вручную.
- Терминалы доступны только из воркспейса в фокусе. Новый терминал появляется в списке после обновления панели (кнопка в шапке или возврат фокуса в панель).
- Опции compose и недавние сервисы живут, только пока панель открыта.
- Worker получает урезанное окружение: `DOCKER_HOST` и `DOCKER_CONTEXT` не видны, endpoint берётся из `~/.docker`. Поддерживаются `unix://`, `npipe://` и `tcp://` без TLS.
- Worker запускается при первом событии Orca (смена статуса агента, создание воркспейса), при вызове команды из палитры или при запросе из панели. Чтобы Orca не выгружала его через 5 минут простоя, worker раз в 2 минуты делает лёгкий `storage.get`. Он занимает один из 5 слотов активных worker.
- Команды рассчитаны на POSIX-shell в терминале.

## Проверки

```sh
npm test
npm run typecheck
```
