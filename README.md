# Corporate AI Agent

Каркас автономного корпоративного агента для разработки. Он рассчитан на локальную установку и OpenAI-совместимую модель во внутренней сети.

## Текущий статус

Выполнен этап 1 ТЗ: pnpm-monorepo, CLI, строгие контракты, загрузка конфигурации, структурированное журналирование и детерминированный `mock`-provider. Изменение файлов, запуск команд, SQLite-память и сетевой provider ещё не реализованы.

## Быстрый запуск

Без установки зависимостей (только mock-provider и Node.js 24+):

```powershell
pnpm dev ask "Опиши назначение агента"
pnpm dev config
```

После установки зависимостей из внутреннего registry:

```powershell
pnpm install --registry https://registry.company.local
pnpm build
node packages/cli/dist/index.js ask "Опиши назначение агента"
node packages/cli/dist/index.js config
```

По умолчанию включён только `mock`-provider. Конфигурация читается из `agent.config.json` в текущем проекте либо из пути в `AGENT_CONFIG`.

## Временный тест с Codex

`agent.codex-test.config.json` включает внешний provider для read-only команд `ask` и `inspect`. Он использует локальную авторизацию `codex login`, запускается в read-only sandbox и отключает web-search. Не используйте его для корпоративного кода или секретов.

```powershell
$env:AGENT_CONFIG = "$PWD\agent.codex-test.config.json"
node packages/cli/dist/index.js ask "Кратко объясни, что такое dependency injection"
Remove-Item Env:AGENT_CONFIG
```

Интерактивный режим, который ждёт следующие вопросы в том же диалоге:

```powershell
$env:AGENT_CONFIG = "$PWD\agent.codex-test.config.json"
node packages/cli/dist/index.js chat
```

Для завершения введите `exit`.

## Контролируемые инструменты

Этап 2 добавляет Policy Engine и инструменты чтения, поиска, атомарного patch с SHA-256 и запуска проверок из allowlist (`pnpm test`, `pnpm run build/check/lint/typecheck`, `git status/diff`, `tsc --noEmit`). Отчёт текущей задачи выводится по флагу `--report`:

```powershell
node packages/cli/dist/index.js inspect --report "Опиши структуру проекта"
```
