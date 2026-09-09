# Corporate AI Agent

Консольный агент для анализа и контролируемого изменения кода. Сейчас реализованы CLI, тестовый provider Codex, Policy Engine, patch с SHA-256, allowlist проверок, SQLite-память и checkpoint.

## Требования

- Node.js 24+
- pnpm 11+
- для реальных ответов: установленный и авторизованный Codex (`codex login`)

Установка и сборка из корня репозитория:

```powershell
pnpm install
pnpm check
pnpm test
```

## Где запускать агент

Текущий каталог определяет workspace: агент читает и меняет только файлы внутри него. Для безопасного первого запуска используйте тестовый проект:

```powershell
cd C:\Projects\2026\tirscript-agent\examples\agent-fixture
```

Если запускать из корня, workspace будет самим репозиторием агента:

```powershell
cd C:\Projects\2026\tirscript-agent
```

## Выбор модели

По умолчанию включён `mock` provider: он не вызывает сеть и возвращает тестовый ответ.

Для временного теста с реальным Codex задайте путь к конфигурации:

```powershell
$env:AGENT_CONFIG = "C:\Projects\2026\tirscript-agent\agent.codex-test.config.json"
```

Эта конфигурация использует локальную авторизацию `codex login`. Она предназначена только для тестовых проектов: запросы и выбранный код отправляются во внешний сервис.

После работы очистите переменную:

```powershell
Remove-Item Env:AGENT_CONFIG -ErrorAction SilentlyContinue
```

### Внешние Qwen и DeepSeek

Оба примера используют OpenAI-совместимый API. Секрет передаётся только через переменную окружения, а не попадает в конфигурацию или Git. Для первого теста используйте `ask` или `inspect`; `run` с внешним provider пока заблокирован.

### Универсальное подключение по URL и API-ключу

Любой OpenAI-совместимый сервис подключается через `.agent/config.json` в workspace:

```json
{
  "provider": {
    "type": "openai-compatible",
    "baseUrl": "https://ваш-api-endpoint/v1",
    "apiKeyEnv": "MY_MODEL_API_KEY",
    "model": "имя-модели"
  },
  "security": {
    "isolationMode": "permissive",
    "allowInternet": true,
    "allowedHosts": ["ваш-api-endpoint"]
  },
  "execution": {
    "maxIterations": 1,
    "maxTokens": 8000,
    "timeoutMs": 120000
  }
}
```

`apiKeyEnv` — это имя переменной окружения, а не ключ. Перед запуском передайте ключ только процессу PowerShell:

```powershell
$env:MY_MODEL_API_KEY = "ваш-api-ключ"
node ..\..\packages\cli\dist\index.js ask "Привет"
Remove-Item Env:MY_MODEL_API_KEY -ErrorAction SilentlyContinue
```

`baseUrl` должен использовать HTTPS, а домен из него должен быть указан в `allowedHosts`. Ключ не сохраняется в конфигурации, SQLite или Git.

DeepSeek:

```powershell
$env:DEEPSEEK_API_KEY = "вставьте-свой-ключ"
$env:AGENT_CONFIG = "C:\Projects\2026\tirscript-agent\agent.deepseek-test.example.json"
node ..\..\packages\cli\dist\index.js ask "Ответь одной фразой: подключение работает"
Remove-Item Env:DEEPSEEK_API_KEY
Remove-Item Env:AGENT_CONFIG
```

Qwen Model Studio US (ключ должен принадлежать тому же региону):

```powershell
$env:DASHSCOPE_API_KEY = "вставьте-свой-ключ"
$env:AGENT_CONFIG = "C:\Projects\2026\tirscript-agent\agent.qwen-test.example.json"
node ..\..\packages\cli\dist\index.js ask "Ответь одной фразой: подключение работает"
Remove-Item Env:DASHSCOPE_API_KEY
Remove-Item Env:AGENT_CONFIG
```

Для Qwen замените `baseUrl` и `allowedHosts` на свой региональный endpoint при необходимости. Ключ Model Studio привязан к региону endpoint.

## Команды

При запуске из `examples\agent-fixture` путь к CLI начинается так:

```powershell
node ..\..\packages\cli\dist\index.js inspect "Опиши проект"
```

При запуске из корня путь к CLI начинается так:

```powershell
node packages\cli\dist\index.js inspect "Опиши проект"
```

### Вопрос без анализа проекта

```powershell
node ..\..\packages\cli\dist\index.js ask "Объясни паттерн Strategy"
```

### Анализ проекта без изменений

```powershell
node ..\..\packages\cli\dist\index.js inspect "Опиши структуру проекта"
node ..\..\packages\cli\dist\index.js inspect --report "Найди точки входа"
```

`--report` выводит план, список изменений, проверки и риски.

### Интерактивный диалог

```powershell
node ..\..\packages\cli\dist\index.js chat
```

После запуска появится `You>`. Введите вопрос и нажмите Enter. Для выхода введите `exit`. В рамках одного запуска сохраняется контекст диалога Codex.

### Контролируемое изменение кода

```powershell
node ..\..\packages\cli\dist\index.js run --report "Добавь функцию createFarewell(name) в src/greeting.js, добавь тест и запусти npm test."
```

`run` доступен только с `codex-local` тестовой конфигурацией. Модель сначала возвращает JSON-план, затем видит только выбранные существующие файлы с SHA-256. Агент проверяет хеши и применяет patch. На текущем этапе новые файлы не создаются.

Разрешённые проверки: `pnpm test`, `pnpm run build/check/lint/typecheck`, `npm test`, `npm run build/check/lint/typecheck`, `git status`, `git diff`, `tsc --noEmit`.

### Конфигурация

```powershell
node ..\..\packages\cli\dist\index.js config
```

Конфигурация читается в таком порядке:

1. путь из `AGENT_CONFIG`;
2. `.agent/config.json` текущего проекта;
3. `agent.config.json` в корне текущего проекта;
4. безопасная конфигурация mock-provider по умолчанию.

Для проекта можно создать `.agent/config.json` на основе [agent.config.example.json](agent.config.example.json). В нём допустимо хранить только несекретные настройки: provider, лимиты, память и правила проекта. Пример есть в [тестовом проекте](examples/agent-fixture/.agent/config.json). Поддержка отдельных profiles и workflows будет добавлена позднее.

Блок `context` ограничивает объём данных, передаваемых модели: `maxFiles` — число релевантных файлов, `maxChars` — общий объём их текста. По умолчанию используются 6 файлов и 30 000 символов.

Перед полным текстом выбранных файлов агент передаёт компактную карту репозитория: путь, импорты и экспорты. Она кешируется локально и обновляется только при изменении SHA-256 файла.

### Память и продолжение задачи

История, логи и SQLite-база находятся вне проекта:

```text
%LOCALAPPDATA%\CorporateAgent\projects\<SHA-256-пути-проекта>\agent.sqlite
```

При первом запуске старая база `.agent\agent.sqlite` автоматически переносится туда. Каталог `.agent` в самом проекте зарезервирован для переносимых несекретных настроек, профилей и workflows.

```powershell
node ..\..\packages\cli\dist\index.js history
node ..\..\packages\cli\dist\index.js status
```

Для продолжения сначала получите идентификатор из `history`, затем сохраните его в переменную:

```powershell
$taskId = "вставьте-идентификатор-из-поля-id"
node ..\..\packages\cli\dist\index.js resume $taskId "Продолжай: проверь результат"
```

## Границы текущей версии

- `ask`, `inspect`, `chat` не изменяют файлы.
- `run` меняет только ранее выбранные существующие файлы через hash-checked patch.
- Чтение `.env`, ключей и сертификатов блокируется.
- `git push` и destructive-команды блокируются.
- Полное восстановление оригинального потока Codex после перезапуска пока не реализовано; `resume` использует последний локальный checkpoint.
