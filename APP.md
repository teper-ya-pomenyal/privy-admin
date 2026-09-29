# privy_stream admin — приложение

Vite + React + TypeScript по макету `Privy Stream Admin.dc.html` (layout B), подогнанное под
контракты `privy_stream/api/v1/openapi.yaml`.

## Запуск

```sh
npm install
npm run dev        # http://localhost:5174/admin/ , API проксируется на GATEWAY_URL (по умолчанию :8080)
npm run build      # dist/ — статика под base /admin/
```

Переменные — см. `.env.example`. В dev все пути API (`/login`, `/register`, `/refresh`, `/logout`,
`/catalog/*`, `/stream/*`) проксируются Vite, так что CORS не нужен. В проде админку стоит раздавать
с того же origin, что и Gateway (либо задать `VITE_API_URL` — CORS в Gateway уже разрешает `*`).

## Что на каком контракте

| Экран | Работает через | Ограничения API v1 |
|---|---|---|
| Вход | `POST /login`, `POST /register`; `POST /refresh` (single-flight, ротация пары), `POST /logout` | роли OWNER в JWT нет — войти может любой аккаунт |
| Обзор | косвенные пробы: `GET /catalog/tracks/{0}/exists` (без токена → gateway, с токеном → catalog), `POST /refresh` с мусорным токеном → user_service, `GET /stream/{0}` → streaming_service | нет `/admin/health`, postgres/redis и диск не видны |
| Релизы | разбор тегов в браузере (`music-metadata`), затем `GET /catalog/artists/search` / `POST /catalog/artists` → `POST /catalog/albums` → на каждый трек `POST /catalog/tracks` + `POST /catalog/tracks/{id}/file` (с прогрессом) → обложка `POST /catalog/albums/{id}/cover` (jpg/jpeg/png/webp/gif, до 3000×3000) → `POST /catalog/albums/{id}/tracks` (позиции) | нет года, жанра, типа (тип выводится из числа треков); очередь живёт только во вкладке; после ошибки публикация продолжается с места остановки |
| Каталог | `GET /catalog/artists/search?artist_name=%` → `/artists/{id}/albums` → `/albums/{id}/tracks`; превью — `GET /stream/{id}`; обложка релиза — статус из `Album.cover_path`, загрузка/замена `POST /catalog/albums/{id}/cover` | только чтение + дозаливка треков и обложки; нет обновления/удаления; файла обложки API v1 не отдаёт — виден только факт её наличия |
| Метки 18+ | флаг `explicit` из каталога; выставляется при создании трека (тумблер + автоопределение по тегам) | нельзя менять у существующего трека, нет очереди жалоб |
| Сессии | текущая сессия: claims access-токена, ручной `/refresh`, `/logout` | нет списка сессий/семей и отзыва чужих |
| Пользователи | — | нет эндпоинтов, экран-заглушка с нужными ручками |
| Логи | журнал HTTP-запросов этой админки к Gateway (200 записей) | серверных логов gRPC нет |

### Хак со списком каталога

Отдельного «список всех артистов/альбомов» нет. `catalog_service` ищет через
`artist_name ILIKE '%' || $1 || '%'` и не экранирует `%`, поэтому `artist_name=%` отдаёт всех.
Это вынесено в `LIST_ALL_WILDCARD` (`src/api/catalogIndex.ts`) — при появлении нормального
списочного эндпоинта менять только там.

### Замечания к бэкенду, найденные по ходу

- CORS в Gateway не разрешает `PATCH` (понадобится для admin-ручек) и заголовок `Range`.
- `LightTrack` из `GET /albums/{id}/tracks` не содержит `position` — при дозаливке следующая позиция считается как «число треков + 1».
- Пути треков и обложек генерирует сервер (`{album_uuid}/{uuid}{ext}`), клиент шлёт только подсказку расширения;
  реальный путь приходит в ответе (`TrackDetails.path`, обложки — `{path, size}`).
- Обложки: `POST /catalog/tracks/{id}/cover` и `POST /catalog/albums/{id}/cover` пишут путь альбому и всем его трекам
  одной транзакцией; **эндпоинта чтения файла обложки в API v1 нет** — в каталоге показан только статус из
  `Album.cover_path`. Для превью с узла понадобится `GET`-ручка хранилища (или раздача статики gateway).

## Структура

- `src/api` — типы по OpenAPI, http-клиент (refresh, ошибки `код · сообщение`, upload через XHR), индекс каталога, пробы здоровья, журнал запросов.
- `src/state` — сессия, тосты, react-query, стор загрузки релизов (`releases.ts`).
- `src/screens` — 7 экранов + вход; `src/components` — оболочка (табы / мобильный таб-бар) и примитивы.
