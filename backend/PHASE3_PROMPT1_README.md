# Phase 3 — Prompt 1: Schedule Settings (Schema + Management Endpoints)

This prompt builds the **storage and management API** for the "auto-generate
schedule" setting (toggle ON/OFF + settable time + which topics/window/type).
It does **not** build the cron engine that acts on this setting — that's the
next prompt. Nothing in Phase 1 (auth) or Phase 2 (pipeline internals) was
touched.

## What's new

```
backend/
  db/
    phase3_schema.sql        # NEW — schedule_settings table, RLS
  src/
    routes/
      schedule.js             # NEW — GET/PUT /api/schedule
    utils/
      validateSchedule.js     # NEW — input validation for PUT /api/schedule
  server.js                   # MODIFIED — mounts the new /api/schedule route
```

## 1. Run the SQL

1. Open your Supabase project → **SQL Editor**.
2. Paste the contents of `backend/db/phase3_schema.sql`.
3. Run it.

Safe to re-run (`IF NOT EXISTS` / `DROP TRIGGER IF EXISTS` guards). This
creates:

- **`schedule_settings`** — one row per user (`user_id` is unique):
  - `enabled` (boolean, default `false`)
  - `scheduled_time` (`text`, `"HH:MM"` 24h format, default `"08:00"`)
  - `topics` (`text[]`, which Phase 2 topics to auto-generate for)
  - `freshness_window` (`text`, one of `6h` / `24h` / `3d`)
  - `update_type` (`text`, one of `news` / `events` / `both`)
  - `timezone` (`text`, default `"UTC"` — stored per-row so this can become
    a real per-user preference later without a schema change; the API
    doesn't expose changing it yet)
  - `created_at`, `updated_at` (the latter kept current via a trigger)

RLS is enabled with **no policies** (deny-all for `anon`/`authenticated`),
matching `users`, `seen_items`, and `cards` — only the service-role key
(used server-side) can read/write it.

A user with no row in this table is not an error case — the API treats them
as "not scheduled" and returns defaults (see below).

## 2. Mount the new route

Already wired in `server.js`:

```js
const scheduleRoutes = require('./src/routes/schedule');
// ...
app.use('/api/schedule', scheduleRoutes);
```

## 3. Endpoints

Both require a valid JWT: `Authorization: Bearer <token>` (same header the
rest of the app uses — get a token from `/api/auth/login` or `/api/auth/signup`).

### `GET /api/schedule`

Returns the current user's schedule settings, or defaults if they don't
have a row yet.

```bash
curl http://localhost:4000/api/schedule \
  -H "Authorization: Bearer $TOKEN"
```

No row yet:

```json
{
  "schedule": {
    "enabled": false,
    "scheduledTime": "08:00",
    "topics": [],
    "freshnessWindow": "24h",
    "updateType": "news",
    "timezone": "UTC",
    "createdAt": null,
    "updatedAt": null
  },
  "hasSchedule": false
}
```

### `PUT /api/schedule`

Creates or updates (upserts) the current user's schedule settings.

```bash
curl -X PUT http://localhost:4000/api/schedule \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "scheduledTime": "07:30",
    "topics": ["tech", "sports"],
    "freshnessWindow": "24h",
    "updateType": "news"
  }'
```

Success (`200`):

```json
{
  "schedule": {
    "enabled": true,
    "scheduledTime": "07:30",
    "topics": ["tech", "sports"],
    "freshnessWindow": "24h",
    "updateType": "news",
    "timezone": "UTC",
    "createdAt": "2026-...",
    "updatedAt": "2026-..."
  }
}
```

Calling `PUT` again with a different body updates the same row (`user_id`
is unique) rather than creating a second one.

`topics` accepts the same friendly aliases the pipeline itself accepts
(e.g. `"technology"` → `tech`, `"news"`/`"world"` → `general`), and
duplicates/aliases of the same topic are collapsed automatically.

### Validation (all return `400` before touching Supabase)

```bash
# Bad time format
curl -X PUT http://localhost:4000/api/schedule -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scheduledTime": "7am", "topics": ["tech"], "freshnessWindow": "24h", "updateType": "news"}'
# -> 400 {"error":"\"scheduledTime\" must be a 24h \"HH:MM\" string, e.g. \"08:00\" or \"23:45\"."}

# Empty topics
curl -X PUT http://localhost:4000/api/schedule -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scheduledTime": "08:00", "topics": [], "freshnessWindow": "24h", "updateType": "news"}'
# -> 400 {"error":"\"topics\" must be a non-empty array of topic names."}

# Unknown topic
curl -X PUT http://localhost:4000/api/schedule -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scheduledTime": "08:00", "topics": ["crypto"], "freshnessWindow": "24h", "updateType": "news"}'
# -> 400 {"error":"\"crypto\" is not a recognized topic. Valid topics: tech, sports, finance, entertainment, general."}

# Bad freshnessWindow / updateType
curl -X PUT http://localhost:4000/api/schedule -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scheduledTime": "08:00", "topics": ["tech"], "freshnessWindow": "1h", "updateType": "news"}'
# -> 400 {"error":"\"freshnessWindow\" must be one of: 6h, 24h, 3d."}
```

No `Authorization` header on either endpoint → `401`, same as every other
authenticated route in the app (`requireAuth` middleware, unchanged).

## Not built in this prompt

- No cron/scheduling execution — nothing currently reads `schedule_settings`
  to actually trigger the pipeline. That's the next prompt.
- No per-user timezone selection via the API yet (column exists, defaults
  to `UTC`, ready for it later).
