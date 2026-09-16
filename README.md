# Scoopr

A personal multi-topic news and updates aggregator. Users pick topics (Tech, Sports,
Finance, Entertainment, General News), the app pulls fresh content, AI polishes it into
short shareable cards (image + caption), and users manually share cards to
WhatsApp/Instagram/X/etc via their phone's native share menu. No auto-posting to any
platform.

This is **Step 1: project foundation** — folder structure, database schema, and
authentication. Content ingestion, AI card generation, and the PWA shell come later.

## Stack

- **Backend:** Node.js + Express
- **Frontend:** React (Vite) — plain shell for now, becomes an installable PWA later
- **Database + Auth:** Supabase (Postgres), accessed via a custom `users` table —
  see "Why not Supabase Auth?" below
- **AI:** Google Gemini API (wired in a later phase)

## Folder structure

```
scoopr/
├── backend/               Express API
│   ├── server.js
│   ├── src/
│   │   ├── config/        Supabase client
│   │   ├── middleware/    JWT auth + role checks
│   │   ├── routes/        auth, admin, me
│   │   └── utils/         JWT signing, temp password generator
│   └── .env.example
├── frontend/               React app (Vite)
│   └── src/
│       ├── api/           fetch wrapper for the backend
│       ├── context/        AuthContext (token/user state)
│       └── pages/          Login, Signup, Home
├── db/
│   └── schema.sql         Run this in Supabase's SQL editor
└── README.md
```

## Why not Supabase Auth?

Supabase has built-in auth, but this app's requirements point to a **custom `users`
table with our own bcrypt hashing and JWTs** instead, for a few concrete reasons:

- Supabase Auth manages password storage itself — you can't hand it a bcrypt hash
  you generated yourself.
- We need a `role` (`admin`/`member`) and `status` (`active`/`disabled`) column
  directly on the user record. With Supabase Auth those would need to live in a
  separate linked `profiles` table, which adds a layer for no real benefit here.
- The admin "reset password" flow generates a plaintext temp password and returns
  it once so an admin can relay it manually — that's not how Supabase Auth's
  password reset works (it emails a reset link instead).

So Supabase is used here purely as the Postgres database. The backend connects with
the **service role key**, which bypasses Row Level Security — this key must never be
exposed to the frontend. The frontend never talks to Supabase directly; it only calls
our own Express API.

## 1. Set up the database

1. Open your Supabase project → **SQL Editor** → New query.
2. Paste in the contents of `db/schema.sql` and run it.
3. This creates the `public.users` table with RLS enabled and no policies, so only
   the service role key (used server-side) can read or write it.

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

- `SUPABASE_URL` — already filled in for your project
  (`https://llpfulzbgionacsztdtm.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Project Settings → API →
  **service_role** key (secret — not the publishable/anon key)
- `JWT_SECRET` — any long random string, e.g. generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- Leave the rest as defaults for local dev

Run it:

```bash
npm run dev
```

The API starts on `http://localhost:4000`. Check `http://localhost:4000/api/health`
in a browser — you should see `{"status":"ok"}`.

## 3. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The app starts on `http://localhost:3000`.

## 4. Test signup/login locally

1. With both servers running, open `http://localhost:3000`.
2. Click **Sign up**, create an account. You'll land on the Home page, which only
   renders when a valid token is present — proof auth is working end to end.
3. Log out and log back in from the Login page to confirm login also works.

### Creating your first admin

There's no public endpoint to self-promote to admin (intentionally — that'd be a
security hole). After you've signed up once, run this in the Supabase SQL editor:

```sql
update public.users set role = 'admin' where username = 'your_username_here';
```

That account can now call the `/api/admin/*` endpoints:

- `GET /api/admin/users` — list all users (no password data)
- `POST /api/admin/reset-password/:userId` — generates and stores a hashed temp
  password, returns the **plaintext temp password once** in the response for the
  admin to relay manually
- `POST /api/admin/disable-user/:userId` — toggles a user between `active` and
  `disabled`

You can call these with `curl` or a tool like Postman/Insomnia, passing
`Authorization: Bearer <admin's JWT>` (the token returned from that admin's login).

## Phase 3, Prompt 1 — Schedule settings (storage + API only)

Adds the storage/management side of the "auto-generate schedule" setting
(toggle ON/OFF, time, topics, freshness window, update type). See
`backend/PHASE3_PROMPT1_README.md` for the SQL to run and curl examples for
`GET /api/schedule` and `PUT /api/schedule`. The cron/execution logic that
acts on this table is the next section below.

## Phase 3 — Cron engine + manual "Generate Now"

Adds the execution engine that acts on Phase 3, Prompt 1's schedule
settings: a background poller that triggers each enabled user's pipeline
at their configured time, plus `POST /api/pipeline/generate-now` to run
it immediately on demand. See `backend/PHASE3_CRON_ENGINE_README.md` for
the scheduling design (why one polling job instead of one per user),
overlap protection, curl examples, and a note on Render free-tier
instances sleeping.

## Phase 3, Prompt 2 — Manual "Create" mode

Adds a second way to get a card into the system besides the auto
pipeline: the user types a raw idea, Gemini enriches it with general
context, a suggested caption, and a suggested source/angle (explicitly
told it has no live web access and must not invent specific facts), and
the result is stored via `POST /api/create` with `sourceType: 'manual'`
so it's distinguishable from auto-generated cards. See
`backend/PHASE3_PROMPT2_README.md` for the schema changes
(`cards.source_url` made nullable, `cards.enrichment_note` added) and
curl examples.

## Phase 3, Prompt 3 — Real tech events logic

Makes the "events" half of the News/Events/Both toggle actually generate
something different from regular news: `updateType: 'events'` now runs a
new Gemini-backed events generator instead of Reddit/RSS/HN, and
`'both'` merges the two. See `backend/PHASE3_PROMPT3_README.md` for what
counts as an "event" here, how the Gemini prompting avoids fabricating
dates it isn't confident about, and its main limitation (Gemini's
knowledge cutoff means very recent/future events can be incomplete).

## Phase 3, Prompt 4 — Tips & Facts generator

Adds a self-contained, evergreen content type — short tech tips and fun
facts, deliberately not tied to any freshness window — generated via
Gemini into its own `tips_facts` table (not `cards`, since it has no
`source_url`/`source_type` in the news-pipeline sense). See
`backend/PHASE3_PROMPT4_README.md` for the `POST /api/tips-facts/generate`
and `GET /api/tips-facts` endpoints and the evergreen-content prompting
approach (no dates, versions, or anything with a shelf life).

## Phase 3, Prompt 6 — Final Consolidation + Robustness (Phase 3 Complete)

The last prompt of Phase 3 — not a new feature, a wiring/robustness pass
over everything Prompts 1-5 built. See `backend/PHASE3_PROMPT6_README.md`
for the full writeup; short version:

- **Wiring review:** verified `server.js` mounts every Phase 3 route and
  that `updateType` flows correctly from `schedule_settings` through the
  cron scheduler and "Generate Now" into `pipeline.js`'s actual
  news/events/both branching. No Phase-2-style "built but never wired
  in" gap was found this time — verified by booting the server and
  confirming every Phase 3 endpoint returns `401` (mounted, auth
  required) rather than `404` (not mounted) without a token.
- **Consistent card shape:** confirmed all four content sources
  (Reddit/RSS/HN auto pipeline, generated events, manual Create, Tips &
  Facts) are cleanly distinguishable via `source_type` (or, for Tips &
  Facts, by living in their own separate `tips_facts` table entirely)
  with no field collisions downstream.
- **Error resilience:** confirmed every Phase 3 Gemini call site
  (events generation, tips/facts generation, manual create enrichment)
  already fails gracefully with a clear logged reason rather than
  crashing — important since cron runs unattended.
- **Gemini rate-limit awareness (new):** added
  `backend/src/utils/geminiThrottle.js` — call pacing + retry-with-
  backoff on `429`/`503`, adapted from `reddit.js`'s existing Phase 2
  backoff pattern — wired into the single shared `callGemini()` function
  every Gemini call site already goes through, so all four Gemini-calling
  code paths are throttled from one shared queue.
- **New status endpoint (new):** `GET /api/test/phase3-status`
  (authenticated) — one consolidated JSON health check across
  `schedule_settings`/`tips_facts` table reachability, whether the cron
  scheduler actually started, and (by inspecting the live Express app's
  router stack, not just checking files exist) whether every Phase 3
  route is genuinely mounted in the running process.

**Phase 3 is now feature-complete.** Everything above is backend/API
only — **there is still no UI** for schedule settings, Generate Now,
manual Create, or Tips & Facts. `frontend/src/pages` still only has
Login/Signup/Home from Phase 1. **Phase 4 builds the full 7-tab frontend
that will call all of this.**

### What's testable right now (Phase 3, all via curl/Postman with a Bearer token)

```
GET  /api/schedule                    — current schedule settings
PUT  /api/schedule                    — save schedule settings
POST /api/pipeline/generate-now       — run the pipeline immediately
POST /api/create                      — manual Create mode
POST /api/tips-facts/generate         — generate a batch of tips/facts
GET  /api/tips-facts                  — list saved tips/facts
GET  /api/test/phase3-status          — consolidated Phase 3 health check
```

Plus the still-open (no-auth, backend-diagnostic) Phase 2 test routes:
`GET /api/test/fetch`, `GET /api/test/pipeline`, `GET /api/test/pipeline/full`.

## Phase 4, Prompt 1 — App shell, navigation, base components

The first Phase 4 prompt. Builds no real tab content yet — it's the
reusable shell (routing, nav, profile menu, component library) every
later Phase 4 prompt builds on top of. Design system: strict monochrome
(black background, `#141414` surfaces, white text, gray-only muted
text/labels — no color anywhere), Inter typeface, large rounded corners,
a floating frosted-glass bottom nav.

### New frontend structure

```
frontend/src/
├── styles/
│   ├── tokens.css         Design tokens — colors, spacing, radii, type (CSS vars)
│   ├── global.css         Reset + base typography
│   └── index.css          Imports the two above
├── components/
│   ├── ui/                Shared component library
│   │   ├── Button.jsx     primary / secondary variants
│   │   ├── Card.jsx       base rounded surface
│   │   ├── Input.jsx      text input + textarea, label + error support
│   │   ├── Pill.jsx       tag/label pill, selectable + active states
│   │   ├── Toggle.jsx     on/off switch
│   │   ├── Loading.jsx    Spinner, Skeleton, LoadingScreen
│   │   ├── ui.css
│   │   └── index.js       barrel export — `import { Button, Card, ... } from '../components/ui'`
│   ├── icons/
│   │   └── Icons.jsx      small self-contained icon set (no icon library dependency)
│   ├── layout/
│   │   ├── AppShell.jsx   wraps every authenticated page: ProfileMenu + content + BottomNav
│   │   ├── BottomNav.jsx  floating pill nav — Feed / Create / Tips & Facts / History
│   │   ├── ProfileMenu.jsx top-right avatar → Settings / Account / Admin (if role === 'admin') / log out
│   │   └── layout.css
│   └── shared/
│       └── ComingSoon.jsx reusable "not built yet" placeholder used by every stub page
└── pages/
    ├── Feed.jsx, Create.jsx, TipsFacts.jsx, History.jsx   — placeholders (real content: later prompts)
    ├── Settings.jsx, Account.jsx, Admin.jsx                — placeholders (real content: later prompts)
    ├── Login.jsx, Signup.jsx                               — restyled, same auth logic as Phase 1
    └── auth.css
```

`src/pages/Home.jsx` (the bare Phase 1 landing page) was removed — its
job is now done by the real `/feed` route inside the app shell.

### Routing

- `/` → redirects to `/feed` if logged in, else `/login`.
- `/login`, `/signup` — public; redirect to `/feed` if already logged in.
- `/feed`, `/create`, `/tips-facts`, `/history`, `/settings`, `/account`,
  `/admin` — all protected via a single `ProtectedLayout` route (checks
  the existing `AuthContext` token/loading state, redirects to `/login`
  if there's no valid session) that wraps them in `AppShell`.
- `/admin` has an extra `AdminRoute` guard that redirects non-admins to
  `/feed` even if they navigate there directly — on top of the profile
  menu simply not showing the link for non-admins.
- Any unknown path redirects to `/`.

Auth/session logic itself (token storage, `getMe`, login/signup calls)
is untouched from Phase 1 — the shell just consumes the existing
`useAuth()` context.

### Running the frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:3000` (backend expected at
`http://localhost:4000/api`, per `VITE_API_BASE_URL` / `authApi.js`).
Sign up or log in, and you'll land on `/feed` with the bottom nav and
profile avatar visible — tapping a nav item or the avatar menu moves
between the placeholder tabs. Every tab beyond the shell itself is
"Coming soon" until its dedicated Phase 4 prompt.

## Phase 4, Prompt 2 — Feed tab: browsing

Builds the real Feed tab: browsing generated cards, topic filtering,
infinite scroll, loading and empty states. Approve/Edit/Skip and share
are explicitly **not** part of this prompt — that's next.

### Backend: new endpoint added (was genuinely missing)

Checked first, per the prompt — nothing in `backend/src/routes/` read
from `cards` before this; only writes existed (`cardStore.insertDraftCards`,
called from the pipeline and manual-create). So this prompt adds:

```
backend/src/routes/cards.js
  GET /api/cards
    ?topic=<tech|sports|finance|entertainment|general|all>  (default: all)
    ?status=<draft|approved|skipped|all>                    (default: draft)
    ?limit=<1-50>                                            (default: 20)
    ?offset=<0+>                                             (default: 0)

    -> { cards: [...], nextOffset: number|null, hasMore: boolean }
```

Same conventions as `routes/tipsFacts.js`: `requireAuth`, camelCase
response shaping, topic aliases via `config/topics.js`'s
`resolveTopicKey`. Wired into `server.js` right after the tips-facts
route.

**Why `status` defaults to `draft`:** the Feed tab is the review queue for
freshly-generated content — cards nobody has actioned yet. Everything the
pipeline inserts starts as `'draft'` (see `cardStore.js`), and Approve/Skip
(which will move a card to `'approved'`/`'skipped'`) don't exist yet, so
in practice every card is currently `'draft'` anyway. The status filter
still accepts any value (or `all`) for testing and for the later History
tab, which will likely default to `?status=approved`.

**Why offset/limit pagination, not a cursor:** cards are ordered by
`created_at desc`; a naive offset can, in theory, skip/repeat a row if a
new card is inserted mid-scroll, but at Scoopr's scale (a personal
aggregator, not a firehose) that's an acceptable trade for the
simplicity of matching the existing `tipsFacts.js` list-endpoint pattern
exactly, instead of introducing a second pagination style into the
codebase for one screen. The route fetches `limit + 1` rows per page so
it can report `hasMore` without a separate `COUNT` query.

### Frontend: new files

```
frontend/src/
├── api/
│   └── cardsApi.js              getCards({ token, topic, offset, limit }) — same
│                                 fetch-wrapper convention as authApi.js, plus
│                                 the Authorization header cardsApi needs.
├── config/
│   └── topics.js                Frontend topic list (key + label), mirrors
│                                 backend/src/config/topics.js by hand.
├── utils/
│   └── relativeTime.js          formatRelativeTime() — dependency-free "2h ago".
├── components/
│   ├── icons/Icons.jsx          + IconImagePlaceholder (new) — dark placeholder
│   │                             glyph for cards with no image_url.
│   └── feed/
│       ├── TopicFilter.jsx       Horizontal pill row (built on the existing
│       │                         Pill component's active/selectable states).
│       ├── CardListItem.jsx      One feed row: thumbnail/placeholder, topic
│       │                         label, relative time, title, caption.
│       ├── CardListItemSkeleton.jsx  Same layout, Skeleton blocks — shown
│       │                         while the initial page is loading.
│       └── FeedEmptyState.jsx    "Nothing here yet" state with a link to
│                                 /settings (not fully built yet, so this
│                                 just points the user there for now).
└── pages/
    ├── Feed.jsx                 Rewritten from the Prompt 1 ComingSoon
    │                             placeholder — real fetch + state.
    └── feed.css                 Imported centrally in main.jsx, same
                                  pattern as ui.css/layout.css/auth.css.
```

### Pagination choice: infinite scroll (not numbered pages)

Implemented via an `IntersectionObserver` watching a sentinel `<div>`
at the bottom of the card list; when it scrolls into view, `Feed.jsx`
fetches the next `offset`/`limit` page from `GET /api/cards` and appends
it. **Why infinite scroll over page numbers:** the design system's
target feel is "premium 2026 consumer app" (Arc/Linear/Things 3), and
this is fundamentally a continuous browsing/review queue, not a
paginated table — a "Page 1 2 3" control would read as an admin
dashboard, which the spec explicitly says to avoid. Switching the topic
filter resets to offset 0 and replaces the list rather than trying to
merge two different filtered result sets.

### Loading, empty, and error states

- **Initial load:** 5 `CardListItemSkeleton` rows (shared `Skeleton`
  component from Prompt 1), matching the real card's layout so nothing
  jumps when data arrives.
- **Loading more:** a small `Spinner` under the list while the next page
  fetches.
- **Empty:** `FeedEmptyState` — different copy depending on whether the
  whole feed is empty (brand-new account, nothing generated yet) or just
  the current topic filter has nothing, with a button linking to
  `/settings` since that's where scheduling/"Generate Now" will live.
- **Error** (e.g. network failure, expired session): an inline message
  with a "Try again" button that re-runs the initial load.

### Testing this locally

With the backend running and a logged-in session:

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/cards?topic=tech&limit=5"
```

If you have no cards yet, run the pipeline first (see the Phase 3, Cron
engine section above — "Generate Now" via
`POST /api/pipeline/generate-now`), then reload the Feed tab.

## Phase 4, Prompt 3 — Card Review Flow + Native Share

Adds Approve / Edit / Skip / Share to every card in the Feed, on top of
Prompt 2's browsing/filtering/pagination (untouched — this prompt is
purely additive on top of it). Per the spec: **this never auto-posts
anywhere.** Approve only flips a status column in the database; Share
only opens the device's own OS share sheet (or, as a fallback, copies to
the clipboard) for the user to pick a destination themselves. There is
no code anywhere in this codebase that sends a card to WhatsApp,
Instagram, X, Telegram, or any other service directly.

### Backend: new endpoint added

```
backend/src/routes/cards.js
  PATCH /api/cards/:id
    Body (JSON, at least one field):
      status   "draft" | "approved" | "skipped"
      caption  non-empty string (trimmed)

    -> { card: {...} }   (same shape as a GET /api/cards row)
```

- `status` alone → Approve (`{status:"approved"}`) or Skip
  (`{status:"skipped"}`).
- `caption` alone → Edit-Save. Leaves `status` as whatever it already
  was — see "Why Edit and Approve are separate requests" below.
- Both together are accepted in one call too (the route doesn't care,
  it just applies whichever fields are present) — the UI just doesn't
  currently use that combined form, see below.
- Validates `status` against the same `draft|approved|skipped` set the
  `cards` table's `check` constraint already enforces, and requires a
  non-empty trimmed `caption`. Malformed `:id` → 400, no matching row →
  404, anything else → 500. `requireAuth`-protected, same as every other
  cards route — no ownership check beyond that, matching the fact that
  `GET /api/cards` has never filtered by user either (Scoopr is a
  single-tenant personal aggregator; every authenticated user sees the
  same card pool).

### Interaction design: buttons on the card, not tap-to-expand

Actions live directly on each Feed row as a button row (Approve / Edit /
Skip / Share), rather than requiring a tap into a detail view first.
Reasoning: the Feed is fundamentally a **review queue** — the point is
to move through a stack of drafts quickly, deciding on each one, not to
navigate in and out of individual card screens. A tap-to-expand pattern
would add a screen transition to every single decision, which fights
against "premium, fast, restrained" more than it serves it. The one
exception is Edit, which genuinely needs more room than a button row —
so tapping Edit swaps the button row for an inline textarea (Save /
Cancel) in place, instead of opening a modal or a separate screen. This
keeps the user's scroll position and context intact.

### Why Edit and Approve are two separate taps

The spec frames Edit as fixing the caption *before* approving — two
distinct steps, not one combined "save-and-approve" action. Keeping them
as separate PATCH requests means:

- Saving an edit doesn't force a decision about approving in the same
  motion. The user can edit, save, sit with it, and either Approve or
  Skip afterward with no separate "undo" affordance needed — not
  approving yet *is* the undo.
- Each request stays a minimal, single-purpose PATCH (one changed field
  most of the time), which keeps the endpoint's behavior easy to reason
  about and test in isolation (see the `curl` examples below).

### Frontend: new + changed files

```
frontend/src/
├── api/
│   └── cardsApi.js              + updateCard({token, id, status, caption})
│                                  wrapping PATCH /api/cards/:id.
├── utils/
│   └── shareCard.js             (new) Native share + clipboard-fallback
│                                  logic — see "Share" below.
├── components/
│   ├── icons/Icons.jsx          + IconCheck, IconEdit, IconSkip, IconShare
│   └── feed/
│       ├── CardActions.jsx      (new) The Approve/Edit/Skip/Share button
│       │                         row, or (while editing) a textarea +
│       │                         Save/Cancel. Owns the busy/spinner state
│       │                         per action and an inline status message
│       │                         (e.g. "Copied caption & link...").
│       └── CardListItem.jsx     Now owns `editing` state (so it can hide
│                                 the clamped caption <p> while an edit is
│                                 in progress) and renders CardActions.
│                                 Browsing display logic unchanged.
└── pages/
    ├── Feed.jsx                 + handleCardUpdate(id, patch): on
    │                             Approve/Skip (`patch.removed`), drops
    │                             the card from local state — it's still
    │                             in the DB for History later, this just
    │                             stops showing it in the draft-only Feed
    │                             view. On an Edit save, merges the
    │                             updated caption into the existing card
    │                             in place. Fetch/pagination/filter logic
    │                             from Prompt 2 is otherwise untouched.
    └── feed.css                 + .card-actions / .card-actions-row /
                                   .card-actions-editing / .card-actions-status
                                   rules, same design tokens as everything
                                   else (no new colors).
```

### Share: how it works, and the fallback behavior

`shareCard(card)` in `utils/shareCard.js` tries, in order:

1. **`navigator.share()` with the card's image attached as a `File`**
   (Web Share API "Level 2" — file sharing). This is what lets apps like
   Instagram or WhatsApp receive the actual image, not just a link. The
   image is fetched client-side and wrapped in a `File`; if that fetch
   fails (e.g. a CORS-restricted image host) or the browser's
   `navigator.canShare({files})` says no, this step is skipped — not
   treated as a failure — and step 2 runs instead.
2. **`navigator.share()` with just `title` / `text` / `url`** — used
   when the Web Share API exists but doesn't support files (or step 1's
   image handling failed). Most current mobile browsers support at
   least this.
3. **Clipboard fallback** — if `navigator.share` doesn't exist at all
   (most desktop browsers as of 2026: desktop Chrome, Firefox, and
   Safari all still lack it outside of PWA-installed contexts), the
   card's caption + link are copied to the clipboard via
   `navigator.clipboard.writeText()`, with an older
   `execCommand('copy')` textarea trick as a last-resort fallback for
   contexts where even the Clipboard API is blocked (e.g. plain HTTP).
   The card shows "Copied caption & link to your clipboard." inline
   under the action row when this path is taken.

If the user opens the native share sheet and then cancels it,
`navigator.share()` rejects with a `DOMException` named `AbortError` —
this is treated as a silent no-op (no error message shown), not a
failure, since cancelling is a normal, expected outcome, not a bug.

**Why this can never auto-post:** every path above either calls the
browser's own `navigator.share()` (which always requires the user to
pick a destination app in an OS-controlled sheet Scoopr's code has no
visibility into or control over) or writes to the clipboard (which does
nothing until the user manually pastes it somewhere). There's no
service-specific SDK, deep link, or API call to any social platform
anywhere in this code.

### Testing this locally

**The PATCH endpoint** (works over plain `curl`, no browser needed):

```bash
# Approve a card
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"status":"approved"}' \
  http://localhost:4000/api/cards/<card-id>

# Edit a caption
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"caption":"A rewritten caption"}' \
  http://localhost:4000/api/cards/<card-id>

# Skip
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"status":"skipped"}' \
  http://localhost:4000/api/cards/<card-id>
```

Then reload the Feed tab — approved/skipped cards should disappear from
it (they're still in `cards` with their new `status`, just outside the
default `?status=draft` filter `GET /api/cards` uses).

**The Web Share API** is genuinely finicky to test locally — a few
things to know going in:

- **It requires a "secure context"**: `https://` in production, or
  `http://localhost` specifically in development (Vite's local dev
  server, e.g. `http://localhost:5173`, qualifies — but `http://` on
  your machine's LAN IP, like `http://192.168.x.x:5173` for testing on
  a phone on the same network, does **not**, and `navigator.share` will
  simply be `undefined` there).
- **Desktop Chrome/Firefox/Edge, and desktop Safari, don't implement
  `navigator.share` at all** in a normal browser tab as of 2026 — on
  any of those, the Share button will exercise the **clipboard
  fallback** (step 3 above), which is fully testable locally: click
  Share, then paste (`Cmd/Ctrl+V`) into any text field to confirm the
  caption + link came through, and watch for the inline "Copied..."
  confirmation message under the card.
- **To test the actual native share sheet** (steps 1/2), you need a
  real mobile device or a Mac running Safari with "Share..." enabled,
  since that's where `navigator.share` is actually implemented in a
  normal tab:
  - **Android Chrome**: visit `http://localhost:5173` via `adb reverse
    tcp:5173 tcp:5173` (or point it at a deployed HTTPS URL) — tapping
    Share should open the real Android share sheet, and file sharing
    (step 1, image attached) generally works here.
  - **iOS Safari**: same idea over a real HTTPS URL (iOS is stricter
    about `localhost` exceptions than desktop browsers) — tapping Share
    opens the iOS share sheet. File sharing support varies by iOS
    version; if it doesn't attach the image, that's step 1 gracefully
    falling back to step 2 (text + link), which is expected behavior,
    not a bug.
  - Either way, choosing an app in the sheet and then backing out
    instead should trigger the silent-cancel (`AbortError`) path — no
    error message should appear.
- If you don't have a deployed HTTPS URL handy yet, the clipboard
  fallback path (desktop) is sufficient to confirm the caption/link
  content and copy mechanics are correct; the native-sheet paths are
  best verified once there's a real deployment to test against.

## Phase 4, Prompt 4 — Create Tab + Tips & Facts Tab

Builds out two of the four `ComingSoon` placeholders from Prompt 1: the
Create tab (manual idea → Gemini-enriched card, backed by Phase 3,
Prompt 2's `POST /api/create`) and the Tips & Facts tab (backed by
Phase 3, Prompt 4's `GET /api/tips-facts` / `POST /api/tips-facts/generate`).
The Feed tab and its review/share components (`CardListItem`,
`CardActions`, `shareCard.js`) are untouched — both new tabs reuse them
rather than duplicating their internals.

### What was reused from Prompt 3 vs newly built

**Reused, unmodified:**
- `components/feed/CardListItem.jsx` and `components/feed/CardActions.jsx`
  — the Create tab renders every freshly-generated card through these
  exact components, so a manual card gets the identical
  Approve/Edit/Skip/Share row a Feed card has. No Create-specific copy
  of this UI exists anywhere.
- `utils/shareCard.js` — the Tips & Facts tab's per-card share icon calls
  the same `shareCard()` function CardActions' Share button uses. Since
  `shareCard()` only ever needs `{title, caption, imageUrl, sourceUrl}`
  and a tip/fact has no title or link of its own, it's called as
  `shareCard({ title: item.content, imageUrl: item.imageUrl })` — same
  native-share → text-share → clipboard fallback chain, just fed the
  tip/fact's content instead of a card's caption.
- `components/ui/*` (Button, Input, Pill, Card, Spinner, Skeleton) —
  every control on both new tabs is one of these; nothing new was added
  to `components/ui/`.
- `api/cardsApi.js`'s `updateCard()` — reused indirectly: since a
  Create-tab card is passed into the unmodified `CardActions`, its
  Approve/Edit/Skip taps call the same `PATCH /api/cards/:id` this
  component already called for Feed cards. No separate update path for
  manual cards exists.

**Newly built:**
- `pages/Create.jsx` — idea textarea, topic pill picker, Generate button,
  session list of generated cards.
- `pages/TipsFacts.jsx` — loads the saved list, "Generate more" button,
  loading/error/empty states.
- `components/tipsfacts/TipFactCard.jsx` — the compact tip/fact card
  (label + content + share icon); no equivalent existed before this
  prompt, since Feed's cards are a different, larger layout (thumbnail +
  headline + caption + action row) that wouldn't fit a one-line tip.
- `components/tipsfacts/TipsFactsEmptyState.jsx` — Tips & Facts' empty
  state triggers generation directly (unlike `FeedEmptyState`, which
  links to Settings, since `POST /api/tips-facts/generate` needs no setup
  first).
- `api/createApi.js` and `api/tipsFactsApi.js` — thin fetch wrappers for
  the two backends this prompt talks to, matching `cardsApi.js`'s
  existing `request()` pattern.
- `pages/create.css` and `pages/tipsfacts.css` — page-specific styles.
  Where an existing class already fit exactly (`.feed-list` for the
  Create tab's generated-card list, `.feed-retry-btn` for both tabs'
  retry buttons), those are reused directly rather than redefined.
- One shared addition to `styles/global.css`: a `.page-heading` class
  (font-size 26/weight 700 — identical to Feed's own `.feed-heading`)
  so Create and Tips & Facts don't each redefine the same page-title
  style Feed already has. Feed keeps using `.feed-heading` unchanged.

### Backend: one small, additive fix

`routes/create.js`'s response shape (`toResponseCard`) was missing `id`
and `topicLabel` — fields `routes/cards.js`'s `toResponseShape` already
returns for Feed cards. Without them, a manually-created card couldn't
be handed to `CardListItem`/`CardActions` at all: `CardActions` needs
`card.id` for its `PATCH /api/cards/:id` calls, and `CardListItem`
renders `card.topicLabel` in its meta row. Both are now included,
computed the same way `routes/cards.js` does (`TOPICS[topic]?.label`).
Nothing else in `routes/create.js`, `services/manualCreate.js`, or the
`cards` table/schema changed.

### Manual test checklist

**Create tab:**
1. Go to Create, type an idea, pick a topic, tap Generate.
2. While it's loading, the button shows a spinner and the field is
   disabled; the request goes to `POST /api/create`.
3. On success, the idea textarea clears and the new card appears below
   with the same look and Approve/Edit/Skip/Share row as a Feed card.
4. Generate a second idea — the first card should still be there, with
   the new one added above it.
5. Tap Approve or Skip on one — it should disappear from the Create
   tab's list (same as Feed) while the other stays. Reload the Feed tab
   filtered to `?status=approved`/`skipped` (or just check Supabase) to
   confirm the row landed there with the right status.
6. Tap Edit, change the caption, Save — the card updates in place
   without disappearing.

**Tips & Facts tab:**
1. On a fresh account (no tips/facts yet), the tab shows the empty state
   with a "Generate tips & facts" button.
2. Tap it — `POST /api/tips-facts/generate` runs, and the new batch
   appears as a list of compact cards (small "TIP"/"FACT" label, content,
   share icon).
3. Tap "Generate more" at the top — a new batch is prepended above the
   existing ones (no page reload, no loss of what was already there).
4. Tap a share icon — same native-share-sheet / clipboard-fallback
   behavior as the Feed's Share button (see Prompt 3's section above for
   the full browser-by-browser breakdown of how to test this locally).

## Phase 4, Prompt 5 — History Tab + Settings Tab

Builds out the last two `ComingSoon` placeholders from Prompt 1: History
(the full historical record of every card, all statuses) and Settings
(the Auto-Generate schedule form + "Generate Now", living behind the
profile menu, not the main floating nav — that route was already wired
in Prompt 1). The Feed/Create/Tips & Facts tabs are untouched.

### What was reused vs newly built

**Reused, unmodified:**
- `components/feed/TopicFilter.jsx` — History's topic pill row is the
  exact same component Feed uses; no second copy of "scrollable row of
  topic pills" exists.
- `.feed-error` / `.feed-retry-btn` / `.feed-sentinel` (from `feed.css`)
  — History's error state and infinite-scroll loading spinner reuse
  these classes directly rather than redefining identical CSS.
- `components/ui/*` (Card, Input, Pill, Toggle, Button, Spinner,
  Skeleton) — every control on both new tabs is one of these; nothing
  new was added to `components/ui/`. In particular, Settings' time
  picker is just `<Input type="time" />` (Input already spreads
  arbitrary props onto the underlying `<input>`), and its topic
  multi-select / freshness-window / update-type selectors are all plain
  `<Pill>`s per the "reuse the Pill selector pattern" instruction —
  no new selector component was built.
- `api/cardsApi.js`'s `getCards()` — extended (see below) rather than
  duplicated into a second History-specific API function.

**Newly built:**
- `pages/History.jsx` — search box (client-debounced, 350ms) + status
  filter + topic filter, backed by the same infinite-scroll
  (IntersectionObserver-on-a-sentinel) approach as `pages/Feed.jsx`,
  just over an unfiltered-by-default slice of the `cards` table.
- `components/history/StatusFilter.jsx` — status pills (All / Approved
  / Skipped / Draft), same structure as `TopicFilter` (down to reusing
  its `.topic-filter` CSS class), just a different option list.
- `components/history/HistoryListItem.jsx` +
  `HistoryListItemSkeleton.jsx` — the compact row style the spec asked
  for: small 40px thumbnail, single-line headline, one muted-gray
  meta line (topic · status · relative time). No caption, no
  Approve/Edit/Skip/Share row — History is a read-only record, not a
  review queue.
- `components/history/HistoryEmptyState.jsx` — distinguishes "nothing
  has ever happened yet" from "your filters/search matched nothing".
- `pages/Settings.jsx` — Auto-Generate toggle, scheduled-time picker,
  topic multi-select, freshness-window selector, update-type selector,
  Save (with a client-side "pick at least one topic" check ahead of the
  identical server-side one, plus a "Saved." confirmation that clears
  itself the moment any field changes again), and a separate
  Generate Now section with its own loading/result state.
- `api/scheduleApi.js` — thin wrappers for `GET`/`PUT /api/schedule`
  and `POST /api/pipeline/generate-now`, matching the existing
  `request()` pattern each tab's API file already uses
  (`cardsApi.js`, `createApi.js`, `tipsFactsApi.js`).
- `config/statuses.js` — status filter options for History, mirroring
  `config/topics.js`'s `FEED_TOPICS` convention (including the
  frontend-only `'all'` pseudo-value).
- `pages/history.css` and `pages/settings.css` — page-specific styles,
  wired into `main.jsx` alongside the existing per-tab stylesheets.

### Backend change: one additive query param

`routes/cards.js`'s `GET /api/cards` gained one new optional query
param, `search`, for History's search box:

- `search` — case-insensitive substring match against **title OR
  caption**, implemented as a PostgREST `ilike` `.or()` filter
  (`title.ilike."%term%",caption.ilike."%term%"`).
- The user-supplied term is escaped before being interpolated: ILIKE
  wildcards (`%`, `_`) are backslash-escaped so a literal `%` or `_`
  the user types is matched literally rather than acting as a
  wildcard, and double quotes are escaped since the term is wrapped in
  `"..."` (required by PostgREST's `or()` syntax whenever a value might
  contain a comma or parenthesis).
- Everything else about the endpoint — `topic`, `status` (including
  `?status=all`, which already existed since Prompt 2 specifically
  "for the later History tab"), `limit`/`offset` pagination — is
  unchanged. History simply calls it with `status=all` by default
  (overridable via its own status pills) instead of the Feed's
  `status=draft` default.

No other route, service, or the `cards`/`schedule_settings` schemas
were touched. `routes/schedule.js` and
`routes/pipelineGenerateNow.js` were used as-is — Settings is a pure
frontend consumer of endpoints that were already complete.

### Manual test checklist

**History tab:**
1. Go to History with an account that has a mix of approved/skipped/
   draft cards. All of them should appear, most recent first, in the
   compact list — no action buttons, just thumbnail + title + topic ·
   status · time.
2. Type into the search box — after a brief pause (no need to press
   Enter), the list narrows to cards whose title or caption contains
   that text, across all statuses/topics currently selected.
3. Tap a status pill (e.g. "Skipped") — the list narrows to just that
   status; combine with a topic pill and/or the search box and confirm
   all three filters apply together (AND, not OR).
4. Clear the search box and reset filters to "All" — the full list
   returns.
5. Scroll to the bottom of a long list — the next page loads
   automatically (infinite scroll), same as Feed.
6. On a brand-new account with zero cards, History shows the "No
   history yet" empty state (not the "no matches" one).

**Settings tab:**
1. Open the profile menu (top-right avatar) → Settings. Confirm this is
   not reachable from the bottom nav.
2. On first load, the form is pre-filled from `GET /api/schedule`
   (defaults if you've never saved one: disabled, 08:00, no topics,
   24h, news).
3. Toggle Auto-Generate on, set a time, select a couple of topic pills,
   pick a freshness window and update type, tap Save Changes — a
   "Saved." confirmation appears below the button, and reloading the
   tab shows the same values came back from the server.
4. Tap Save Changes with zero topics selected — a validation message
   appears immediately, with no network request.
5. Tap Generate Now — the button shows a loading state, then either a
   success message naming how many topics generated (check the Feed
   tab for the new draft cards) or a clear error (e.g. if no topics are
   saved yet).
6. Change a field after saving — the "Saved." confirmation disappears,
   since it no longer describes the current form state.

## Phase 4, Prompt 6 — Account Tab + Admin Panel

Both live behind the profile menu (top-right avatar), not the bottom
nav — that link set was already wired since Prompt 1
(`ProfileMenu.jsx` → Settings / Account / Admin Panel). This prompt
replaces the two remaining `ComingSoon` placeholders (`pages/Account.jsx`,
`pages/Admin.jsx`) with real implementations and adds one small backend
endpoint for role management.

### Account tab (all users)

- Reads straight from `AuthContext`'s `user` (already loaded via
  `GET /api/me` on session start) — no new fetch needed. Shows username,
  email, role, and status.
- **Log out** calls the existing `AuthContext.logout()` (clears the
  stored token) and redirects to `/login`.
- No self-serve password reset form exists, by design (see "Why not
  Supabase Auth?" above and Phase 1's architecture decision). The page
  states this plainly: *"Need a password reset? Contact an admin."*
  rather than a dead-end form.

### Admin Panel (admin role only)

- Lists every user (username, email, role, status) via
  `GET /api/admin/users` — this endpoint already existed from Phase 1
  (`backend/src/routes/admin.js`), unchanged.
- **Admin Reset**: calls the existing
  `POST /api/admin/reset-password/:userId` (Phase 1, unchanged), which
  generates a temp password server-side, hashes and stores it, and
  returns the plaintext value exactly once in that response. The
  frontend shows it in a one-time modal (`resetResult` state) and holds
  no other reference to it — closing the modal discards it for good,
  matching the "no visible passwords ever" rule used everywhere else in
  the app.
- **Role management**: new endpoint,
  `PATCH /api/admin/users/:userId/role` (`backend/src/routes/admin.js`),
  since nothing before this prompt could change a role after signup
  (signup always creates `role: 'member'`). Body is `{ role: 'member' | 'admin' }`;
  invalid values 400. An admin cannot change their **own** role — the
  backend checks `userId === req.user.id` and rejects it before touching
  the database, and the frontend disables that user's own row for the
  same reason (a UX nicety layered on top of the real, server-side
  check, not a substitute for it). Promote/demote in the UI is behind a
  confirm modal since it's a meaningful permission change, not an
  instant action.
- New frontend files only: `src/pages/Admin.jsx`, `src/pages/admin.css`,
  `src/api/adminApi.js`. `src/pages/Account.jsx` / `account.css` for the
  Account tab. No other tab, route, or shared component was touched.

### How admin-only access is enforced (two independent layers)

This matters enough to spell out explicitly, since a hidden link is not
real protection:

1. **Backend (the actual boundary).** `backend/src/routes/admin.js`
   mounts `requireAuth` then `requireRole('admin')` on the *whole
   router* (`router.use(requireAuth, requireRole('admin'))`), not on
   individual routes. `requireAuth` (`middleware/auth.js`) rejects any
   request without a valid, unexpired JWT, and re-fetches the user's
   current role/status from the database on every request — so a role
   change or a disabled account takes effect immediately, even for a
   token issued before that change. `requireRole('admin')`
   (`middleware/role.js`) then 403s anyone whose *current* role isn't
   `'admin'`. Every single `/api/admin/*` route — including the new
   `/users/:userId/role` — inherits this automatically. A non-admin (or
   unauthenticated) request gets a 403/401 no matter what the frontend
   does; there's no way to reach the data or the actions by, say,
   calling the API directly with curl.
2. **Frontend (UX only, not security).** Two independent, redundant
   guards, neither of which does any real enforcement on its own:
   - `ProfileMenu.jsx` only renders the "Admin Panel" menu item when
     `user.role === 'admin'` — hides the entryway for non-admins.
   - `App.jsx`'s `<AdminRoute>` wrapper checks `user.role === 'admin'`
     before rendering `<Admin />` at all, redirecting to `/feed`
     otherwise — this blocks a non-admin from reaching the page even by
     typing `/admin` in the URL bar directly, without waiting for a
     failed API call.

   Both of these exist purely so a non-admin never even sees a page
   whose every button would 403 anyway — neither is what actually stops
   a non-admin from reading or modifying user data. That's entirely
   `requireAuth` + `requireRole('admin')` on the backend, from #1.

### Manual test checklist

1. Log in as a `member` account. Open the profile menu — no "Admin
   Panel" item appears. Manually navigate to `/admin` in the URL bar —
   you're redirected to `/feed`.
2. While still logged in as that `member`, try
   `curl -H "Authorization: Bearer <member's token>" http://localhost:4000/api/admin/users`
   — expect a `403`, confirming the backend blocks it independent of
   the frontend redirect above.
3. Log in as an `admin` account. Open the profile menu — "Admin Panel"
   appears; tapping it shows the full user list with role + status
   badges.
4. Tap **Admin Reset** on some other user — a modal shows a temp
   password once; dismiss it and confirm there's no way to see that
   value again from the UI (it's not logged in state anywhere else).
5. Tap **Promote to Admin** / **Demote to Member** on another user —
   confirm the modal's wording, confirm it, and see the badge update in
   place without a full page reload.
6. Confirm the admin's own row has that action disabled (with a tooltip
   explaining why), and that calling the endpoint directly for your own
   id (e.g. via curl) returns a 400.
7. Go to Account (profile menu) — username/email/role/status match what
   you'd expect, "Log out" clears the session and lands you on
   `/login`, and the password section reads "Need a password reset?
   Contact an admin." with no form.

## Phase 4, Prompt 7 — Onboarding Flow + Final Polish (Phase 4 Complete)

The last prompt of Phase 4 — two jobs: build the first-run onboarding
experience, then do a consistency/robustness pass over every screen
Prompts 1–6 built (same "wiring-gap-check discipline" as Phase 3's final
consolidation prompt — see that section above). After this prompt, the
app is genuinely usable end-to-end through the UI; no more curl commands
needed for core flows.

### 1. Onboarding flow

A short 3-step flow shown once, right after signup, before the user ever
reaches the main app tabs: **topics → freshness window → update type**.
It's deliberately not a heavy wizard — one `<Card>` per step, a small
progress-dot indicator, Back/Continue/Finish, and a "Skip for now" link,
all built from the exact same `components/ui/*` (Card, Pill, Button)
every other screen already uses. No new shared component was added.

**How completion is saved and detected — no schema change:**

- Finishing (or skipping) the flow calls the *existing*
  `PUT /api/schedule` (Phase 3, Prompt 1 — completely unchanged) with the
  user's picks, `enabled: false`, and the same `08:00` default time
  `routes/schedule.js`'s own `DEFAULT_SCHEDULE` already uses. Auto-generate
  itself is **not** turned on by onboarding — per the spec, that's still
  an explicit opt-in on Settings; onboarding only pre-fills *preferences*
  so Settings isn't empty on first visit.
- "Skip for now" still needs to save a **valid** row (the backend's
  `validateScheduleInput` requires a non-empty `topics` array regardless
  of `enabled`), so if the user skips without picking anything, it saves
  `["general"]` as a sane default rather than blocking them with a form
  they explicitly tried to skip.
- Whether onboarding is "done" is **inferred, not tracked with a new
  column**: `GET /api/schedule` already returns `hasSchedule: false` for
  any user with no `schedule_settings` row, and `true` once one exists —
  exactly the "no row = not done yet" signal needed, and exactly what the
  prompt's own suggestion of "infer it from whether schedule_settings
  exists" describes. `frontend/src/context/AuthContext.jsx` now fetches
  this alongside `GET /api/me` on session load and exposes it as
  `onboardingComplete` (`null` while unknown, then `true`/`false`).

**Route logic (`frontend/src/App.jsx`):**

- New `/onboarding` route, guarded by a new `<OnboardingRoute>`: requires
  a session (same as every other protected route) and renders
  `pages/Onboarding.jsx` **without** `<AppShell>` — no bottom nav, no
  profile avatar — since the user hasn't set anything up yet and
  shouldn't be able to hop to other tabs mid-flow. A user who's already
  onboarded is redirected straight to `/feed` if they navigate here
  directly, so the flow can't be "redone" by typing the URL.
- `<RootRedirect>` (`/`) and `<ProtectedLayout>` (every `/feed`,
  `/settings`, etc. route) both now check `onboardingComplete === false`
  and redirect to `/onboarding` before rendering anything else — so a
  not-yet-onboarded user can't skip the flow by deep-linking straight to
  `/feed` (or any other tab) either. `Login.jsx`/`Signup.jsx` themselves
  are untouched (still `navigate('/feed')` on success); the redirect
  above is what actually routes a fresh signup to `/onboarding` instead.
- New file: `frontend/src/pages/Onboarding.jsx` +
  `frontend/src/pages/onboarding.css` (wired into `main.jsx` alongside
  every other per-page stylesheet).

### 2. Consistency + polish pass

Went through every Prompt 1–6 screen against the checklist below. Most of
it held up — Prompts 1–6 were already disciplined about only using
`components/ui/*`, giving every list screen a loading/empty/error state,
and keeping every protected route inside `<AppShell>`. What was
genuinely found and fixed:

- **Shared UI components:** confirmed every screen's buttons, cards,
  inputs, pills, toggles, and loading states go through
  `components/ui/*` — no one-off styled elements found that had drifted
  from the design system. (The few raw `<button>`s that exist —
  `TipFactCard`'s share icon, `ProfileMenu`'s avatar/menu items,
  `BottomNav`'s nav items — are icon-only or structurally different
  controls the shared `Button` component was never meant to cover, not
  drift.)
- **Loading/empty states:** Feed, History, and Tips & Facts each already
  had a skeleton-loading state, an error state with retry, and a
  distinct empty state (including a "no results for this filter" variant
  vs. "genuinely nothing yet") — all three were already consistent with
  each other; no gap found here.
- **Floating nav + profile menu on every screen:** confirmed
  `<ProtectedLayout>` wraps all seven tab routes — including
  Settings/Account/Admin, which live behind the profile menu rather than
  the bottom nav — in the same `<AppShell>`, so the nav and avatar render
  everywhere they should. `/onboarding` is the one deliberate exception
  (see above — that's by design, not a gap).
- **AuthContext session-loading race (fixed):** `loading` was previously
  a plain `useState` set to `false` in the session-fetch effect's
  `finally`, but never reset to `true` when `token` changed *after* the
  initial mount (e.g. the instant after login/signup, going from `null`
  to a fresh token). Since it was already `false` from the first,
  logged-out render, `<ProtectedLayout>`/`<RootRedirect>` could render
  for one frame before the new session had actually loaded. Reworked to
  derive `loading` directly from `token`/`user`/`onboardingComplete`
  (true whenever there's a token but the session or onboarding status
  isn't resolved yet) instead of tracking it as separate state that could
  fall out of sync — this is also what makes the onboarding redirect
  above reliable rather than flashing the wrong screen for a frame.
  Added a `cancelled` guard to the fetch effect at the same time so a
  slow, now-stale request from a previous `token` value can't clobber a
  newer one's state.
- **Stale onboarding status across account switches (fixed):**
  `loginSuccess()` now resets `onboardingComplete` to `null` (not just
  `token`/`user`) so that logging out and straight back in as a
  *different* user, without a full page reload, can't carry over the
  previous session's "already onboarded" status and skip the new user's
  first-run flow.
- **Narrow mobile viewport (checked, minor fix applied):** the app was
  already built fluid/flex throughout (no fixed pixel widths beyond
  `max-width` containers), so it held up fine down to ~360px without any
  changes. Below that (a 320px-wide device), the floating bottom nav's
  side margins plus its own inner padding started crowding its 4 labels,
  and the profile avatar sat a little close to the top edge. Added one
  `@media (max-width: 360px)` block each to `layout.css` (tighter nav
  margins/padding, smaller label text, closer-in avatar) and to
  `app-shell-content`'s side padding — scoped to just that breakpoint
  rather than changing the shared spacing tokens every other screen
  keys off.

Nothing else needed changing — Prompts 1–6's screens, components, and
API layer are otherwise untouched by this prompt.

### Manual test checklist

1. Sign up a brand-new account. You should land on `/onboarding` — no
   bottom nav or profile avatar visible — not `/feed`.
2. Step 1: try tapping Continue with no topics selected — inline
   validation blocks it. Select a couple, then Continue.
3. Step 2: pick a freshness window, Continue. Step 3: pick an update
   type, tap **Finish setup**.
4. You land on `/feed`. Open the profile menu → Settings — the form is
   pre-filled with exactly what you picked in onboarding, and
   Auto-Generate is still **off** (you have to turn it on yourself).
5. Log out, log back in as that same account — you go straight to
   `/feed`, not back through onboarding.
6. Manually navigate to `/onboarding` while logged in as that (already
   onboarded) account — you're redirected to `/feed`.
7. Sign up a second brand-new account and tap **Skip for now** on step 1
   without picking anything — you land on `/feed`, and Settings shows
   `General News` pre-selected (the fallback default) rather than an
   empty topic list.
8. With dev tools' device toolbar set to a 320px-wide viewport, check
   Feed/History/Settings/Admin — the bottom nav, profile avatar, pill
   rows, and card action rows should all stay usable with no horizontal
   overflow or clipped text.

## Phase 4 Complete

Everything from Prompt 1 (app shell, nav, base component library) through
Prompt 7 (onboarding + polish) is now built and wired together:

- **First-run onboarding** — a 3-step topics/freshness/update-type flow
  shown once right after signup, saving straight into the same
  `schedule_settings` row Settings reads/writes, with completion inferred
  from `hasSchedule` rather than a new tracked flag.
- **All 7 tabs have real content:** Feed (browse + Approve/Edit/Skip/
  Share), Create (manual idea → Gemini-enriched card), Tips & Facts
  (evergreen content + native share), History (full record, search +
  status/topic filters), Settings (Auto-Generate schedule + Generate Now),
  Account (profile + log out), Admin Panel (user list, password reset,
  role management — admin-only, enforced server-side).
- **App shell:** floating frosted-glass bottom nav (Feed/Create/Tips &
  Facts/History) and a top-right profile avatar (→ Settings/Account/Admin)
  on every authenticated screen except onboarding itself (by design).
- **Design system:** strict monochrome (black background, `#141414`
  surfaces, white text, gray-only muted text/labels, no color anywhere),
  Inter typeface, large rounded corners, held consistently across every
  screen — verified in this prompt's polish pass, see above for the small
  set of genuine fixes that came out of it.
- **Native share only** — Approve/Skip/Edit only ever change a `status`
  column in Scoopr's own database; Share only ever opens the OS share
  sheet or copies to the clipboard. Nothing in this codebase posts to any
  social platform directly.

**The app is now genuinely usable end-to-end through the UI** — sign up,
get onboarded, set a schedule (or use Generate Now / Create), review and
approve cards in Feed, share them, browse History, and (for admins)
manage users — with no curl commands needed for any of that anymore.

**Phase 5 (PWA installability) is next:** `manifest.json`, a service
worker, and "Add to Home Screen" support, so Scoopr can be installed on a
phone like a native app rather than just being a mobile-friendly website.
Nothing in this prompt anticipated that work beyond what was already
true — the app was already mobile-first and responsive throughout — so
Phase 5 should be purely additive on top of everything above.

## Notes for what's next

- No email verification or self-service password reset yet (admin-driven reset only,
  by design, per the spec for this step).
- Account and Admin Panel are built as of Phase 4, Prompt 6 (see that
  section above) — every screen behind the profile menu now has real
  content, and role management (promote/demote) exists for the first
  time since Phase 1.
- History and Settings tabs are built as of Phase 4, Prompt 5 (see that
  section above) — all seven tabs from the Prompt 1 shell now have real
  content.
- Create and Tips & Facts tabs are built as of Phase 4, Prompt 4 (see that
  section above).
- Onboarding + the Phase 4 polish pass are built as of Phase 4, Prompt 7
  (see that section above) — **Phase 4 is now complete**. Phase 5 (PWA
  installability) is next.

## Redesign Phase — R1: Navigation + carryover fixes

Before Phase 5, a short "Redesign Phase" (R1–R5) reworks Feed, Create,
Tips & Facts, and History based on real usage feedback. **R1 covers only
navigation verification and two carryover bug fixes** — R2–R5 rebuild the
actual tab content.

**(a) Bottom nav — 4 items, verified, no change needed.**
`frontend/src/components/layout/BottomNav.jsx` already defines exactly
four `NAV_ITEMS`: Feed, Create, Tips & Facts, History. Settings was never
on the floating nav — `frontend/src/components/layout/ProfileMenu.jsx`
already puts Settings, Account, and (admin-only) Admin Panel behind the
top-right avatar menu, and `App.jsx` still routes `/settings` directly so
deep links keep working. This requirement was already satisfied from
Phase 4; nothing was changed for it.

**(b) Static `/generated` image route — already present, verified against
`OUTPUT_DIR`, no change needed.** `backend/server.js` already has
`app.use('/generated', express.static(path.join(__dirname, 'public',
'generated')))`. Checked it against `imageHandler.js`'s
`OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'generated')`
(that file lives in `backend/src/services/`, so `../../public/generated`
resolves to the same `backend/public/generated` folder server.js serves)
— the two agree, so this was a false alarm for this build, not a genuine
gap. No route was added.

**(c) Fallback image generator — genuinely was colored per topic, now
fixed to monochrome.** `backend/src/services/imageHandler.js` previously
picked a background color per topic (`TOPIC_COLORS`: blue for
tech/technology, green for business/finance, purple for science, etc.)
for its SVG-to-PNG fallback cards. Changed to:
- A single flat `#141414` background for every topic (matches
  `--color-surface` in `frontend/src/styles/tokens.css`), with a subtle
  `#2a2a2a` border (matches `--color-border`) — no color logic at all
  anymore, so `TOPIC_COLORS`/`DEFAULT_COLOR` were removed entirely.
- White (`#ffffff`) title text, matching `--color-text`.
- Topic differentiation now comes only from a small muted-gray
  (`#8a8a8a`, matching `--color-text-muted`) uppercase label with an
  underline accent — same idea as the removed colored pill, just
  rendered in the app's existing muted-gray instead of a topic color.
- Also cleared `backend/public/generated/` of the ~50 PNGs that were
  cached under the old colored template. `generateFallbackImage()` skips
  regeneration when a file already exists at that hash, so those stale
  colored images would otherwise have kept serving indefinitely even
  after the code fix. They'll regenerate automatically (monochrome) the
  next time the pipeline runs.

## Redesign Phase — R2: Feed — Rebuild as a Carousel

The Feed tab's infinitely-scrolling list is gone. It's now a one-at-a-time
carousel showing the user's 6 most recent cards — across both
auto-pipeline and manually-created cards, any status, newest first — with
left/right arrows, swipe support, and a wrap-around "N of total" counter.

**Backend endpoint change: none new, two small additive extensions to the
existing one.** Per the prompt, `GET /api/cards` (Phase 4, Prompt 2) was
checked before adding anything, and it already supported everything the
carousel needed to fetch data: `limit` (capped at 50), `offset`, and
`?status=all` to remove the default drafts-only filter. The Feed page
simply calls it as `GET /api/cards?status=all&limit=6` — no `topic` (every
topic), default `offset=0`. There's no `sourceType` filter anywhere on
this endpoint to begin with, so "don't filter by source" required no
change either — auto-pipeline and manual cards were always returned
together. Two things in `backend/src/routes/cards.js` *did* change,
both purely additive (no existing caller's request/response shape is
affected):

1. **`toResponseShape()` now includes `enrichmentNote`.** This was the
   one genuine bug fix in this prompt: the `cards` row was always queried
   with `select('*')`, so `enrichment_note` was already coming back from
   Postgres on every `GET /api/cards` call — but the response-shaping
   function threw it away before it reached the client. (`routes/create.js`'s
   separate `toResponseCard` — used only for the one card just POSTed
   from Create — already included it; this endpoint's shape never did.)
   That's why the enrichment note showed up on a just-created card in the
   Create tab's local state, but reappeared as `undefined` the moment
   that same card was ever re-fetched through `GET /api/cards` (e.g. by
   the old Feed, or History). Now it's genuinely present end-to-end.
2. **`PATCH /api/cards/:id` now also accepts `title` and
   `enrichmentNote`** (previously only `status`/`caption`), for the
   carousel's Edit action — see below. `enrichmentNote` uniquely allows
   an empty string through (it clears the note) where `title`/`caption`
   both still require non-empty text, matching the field's already-nullable,
   optional nature in the schema.

**What's unchanged on purpose:** `cards.status` and the ability to PATCH
it are still fully intact server-side — Approve/Skip just aren't called
from this screen anymore, since a fixed "6 most recent" snapshot isn't a
queue with a "remove from the list" concept. The Create tab still calls
Approve/Skip through the untouched `<CardListItem>`/`<CardActions>` pair.

**Frontend — new files, nothing shared modified in a breaking way:**
- `components/feed/CardCarousel.jsx` — the slider shell: current-index
  state, wrap-around `goTo()`, on-screen arrow buttons, the "N of total"
  counter, and touch handlers.
- `components/feed/CarouselCard.jsx` — the single large card: image (or
  the R1 monochrome fallback) with `onError` fallback exactly like the
  old `CardListItem`, headline, caption, the enrichment note (now
  genuinely rendered, split on `" | "` the same way `manualCreate.js`
  joins "Context: …" / "Suggested angle: …"), a derived `via <hostname>`
  label for cards with a real `sourceUrl` (omitted for manual cards,
  which have none), and Edit + Share only.
- `pages/Feed.jsx` — rewritten from scratch: fetches once on mount (no
  infinite scroll, no topic filter), renders `<CardCarousel>`, and
  handles loading/error/empty states.
- `components/feed/FeedEmptyState.jsx` — simplified (dropped the
  `filtered` prop/variant, since there's no topic filter to be "filtered"
  by anymore; it's only ever "you have zero cards").
- `components/icons/Icons.jsx` — added `IconChevronLeft`/`IconChevronRight`
  for the arrow controls. Existing icons untouched.
- `pages/feed.css` — all new carousel styling was appended under a
  clearly-delimited `.carousel-*` / `.feed-carousel-*` section, with a
  comment marking where the still-in-use `.feed-card` / `.card-actions`
  rules (needed by `CardListItem`/`CardActions` on the Create tab) end.

**Explicitly NOT modified**, because other screens still depend on them
exactly as they were: `components/feed/CardListItem.jsx`,
`components/feed/CardActions.jsx` (both still used unmodified by
`Create.jsx`), `components/feed/TopicFilter.jsx` (still used unmodified
by `History.jsx`), and `utils/shareCard.js` (reused as-is — it only ever
needed a plain `{title, caption, imageUrl, sourceUrl}` object, which a
carousel card already is).
`components/feed/CardListItemSkeleton.jsx` is no longer imported by
anything (the carousel uses a plain `<Spinner>` for its loading state,
since a single large card doesn't need a list-row-shaped skeleton) but
was left in place rather than deleted, since it's inert and harmless.

**Edit, specifically:** unlike `CardActions`' Edit (caption only),
`CarouselCard`'s Edit opens the full card — headline, caption, and, only
when the card already has one, the enrichment note as a single editable
text block (it's stored as one freeform `text` column, not structured
fields, so it's edited the same way). It's never offered as a field to
*add* a note to a card that never had one, per the spec's "if present."
Saves go through the same `PATCH /api/cards/:id` endpoint, now capable of
taking all three fields in one request.

**Swipe / arrow interaction approach chosen:** a plain controlled-index
slider — `index` React state plus `touchstart`/`touchmove`/`touchend`
handlers on the stage `<div>` — rather than a carousel library or CSS
scroll-snap. A swipe shorter than 50px is ignored (treated as scroll
jitter, not an intentional swipe). Left/right on-screen arrow buttons
call the same `goPrev()`/`goNext()` the swipe handlers do, and — as a
small bonus for non-touch devices — the left/right arrow *keys* do too.
Going past either end wraps via modulo arithmetic
(`((next % count) + count) % count`) rather than clamping or fetching
more; nothing here ever issues a 7th `GET /api/cards` call. This keeps
the carousel dependency-free, matching the rest of the codebase's
existing "small, self-contained, no library where one isn't clearly
needed" pattern (see `Icons.jsx`, `relativeTime.js`).

**Empty / partial states:** 0 cards shows `FeedEmptyState` (same
"go to Settings" guidance as before); 1–5 cards render the carousel
normally, just with a smaller total in the "N of total" counter and, for
exactly 1 card, no arrows/counter at all (nothing to navigate between).
Neither case is treated as an error.

## Redesign Phase — R3: Create Tab — Show Full Enrichment

**The bug this fixes:** the Create tab's main complaint. `POST /api/create`
has generated and saved `cards.enrichment_note` (Gemini's context +
suggested source angle) since Phase 3, but the Create tab handed its
freshly-generated card straight to `<CardListItem>`/`<CardActions>` — the
pre-redesign Feed row, which shows a bold headline and a clamped caption,
and an Edit that only ever touched the caption. The enrichment note was
computed, stored, and then discarded before it ever reached the screen.
Generating a card in Create genuinely produced more than a caption; you
just never saw it.

**Fix: reuse, don't rebuild.** R2 already solved exactly this display
problem for the Feed carousel — `<CarouselCard>` shows the full headline,
caption, and (when present) the enrichment note as clearly-laid-out,
hairline-divided lines, with Edit + Share only and an Edit form covering
headline, caption, and the note itself. `Create.jsx` now imports and
renders that same component completely unmodified, in place of
`<CardListItem>`. This is a **confirmed, genuine fix**: `routes/create.js`'s
response was already shaped compatibly with what `<CarouselCard>` expects
(`id`, `title`, `caption`, `imageUrl`, `topicLabel`, `sourceUrl`,
`createdAt`, `enrichmentNote`) — it needed zero changes — so no backend or
API-layer work was needed, only swapping which component the Create page
hands its result to.

**Frontend — changed files:**
- `pages/Create.jsx` — swapped `<CardListItem>` for `<CarouselCard>`
  (`components/feed/CarouselCard.jsx`, imported unmodified). The
  idea-textarea + topic-pill-picker + Generate button block is untouched;
  only what happens to the result *after* generation changed. Local state
  changed from a `cards` array (newest-first list, one entry per
  successful Generate) to a single `result` value — see "One card or
  many?" below.
- `pages/create.css` — `.create-results` (used to wrap a `feed-list` of
  rows) renamed to `.create-result` (wraps one `<CarouselCard>`); same
  single `margin-top` rule, just re-labeled to match. All of the card's
  own visuals (image, title, caption, enrichment lines, actions) come
  from `feed.css`'s already-global `.carousel-card*` rules — nothing
  duplicated.
- `api/createApi.js`, `api/cardsApi.js` — doc-comment updates only (they
  referenced `<CardListItem>`/`<CardActions>` as the consumer; now say
  `<CarouselCard>`). No behavior change — `createCard()` and
  `updateCard()` were already sending/returning everything needed.

**Explicitly NOT modified:** `components/feed/CarouselCard.jsx`,
`CardCarousel.jsx`, `pages/Feed.jsx`, `pages/feed.css`, Tips & Facts, and
History are all untouched, per the prompt. `components/feed/CardListItem.jsx`
and `CardActions.jsx` are no longer imported by anything, anywhere, after
this change (Feed itself moved off them in R2; Create was their last
caller) — they're left in place unmodified rather than deleted, since
removing shared `feed/` components is outside this prompt's scope.

**Actions: Edit + Share only, no Approve/Skip — for free.** This falls
directly out of reusing `<CarouselCard>`, which never rendered
Approve/Skip to begin with (R2 dropped them for the same "not a queue"
reasoning the carousel uses). Edit opens headline + caption + (only when
the card has one) the enrichment note as a single editable text block —
matching the prompt's "caption is the priority, enrichment note edit if
straightforward" guidance, and matching R2's own edit scope exactly, since
it's the same component. Saves go through the existing
`PATCH /api/cards/:id`, unchanged.

**One card or many? Replaced, not stacked.** `Create.jsx` now keeps a
single `result` (the most recent generation), replaced on every successful
Generate, rather than the old array of every card generated this session.
Reasoning: a full `<CarouselCard>` — image, headline, caption, enrichment
note, action row — is a lot more vertical space than the old clamped list
row was, and Create is a "type one idea, look closely at what came back,
maybe edit or share it, then move to the next idea" loop, not a queue to
compare in bulk (that's what Feed/History are for). Stacking several full
cards after a session of generating would work against that single-focus
flow more than it would help. Nothing is lost from the database's
perspective — every generated card is saved as a `draft` row regardless
of whether the Create page keeps displaying it; a user who wants to find
an earlier session's card again can still find it in History.

**Confirmed working end-to-end:** generating a card via Create now
displays its headline, its caption, *and* — genuinely rendered, not
silently dropped — the "Context: …" / "Suggested angle: …" enrichment
note lines, exactly as R2's Feed carousel shows them for the same field on
re-fetched cards. Editing and re-saving either the caption or the note
persists through `PATCH /api/cards/:id` and is reflected immediately in
the still-visible result card.

**Manual test checklist:**
1. Create tab → type an idea, pick a topic, Generate. Confirm the result
   shows: topic + relative time, headline, caption, an enrichment-note
   block with two lines ("Context: …" and "Suggested angle: …"), and only
   Edit + Share buttons (no Approve/Skip).
2. Tap Edit → change the caption and/or the enrichment note text → Save.
   Confirm the displayed card updates in place and the change survives a
   page refresh (re-fetch via `GET /api/cards` or check History).
3. Generate a second idea from the same screen. Confirm the first
   result is replaced by the new one (not stacked above/below it).
4. Tap Share on a result. Confirm the native share sheet (or clipboard
   fallback) receives the same `{title, caption, imageUrl, sourceUrl}`
   `shareCard()` always used.
5. Confirm Feed, Tips & Facts, and History all look and behave exactly as
   they did before this prompt.

## Redesign Phase — R4: Tips & Facts — No Pile-Up, Generate One at a Time

**The problem this fixes:** the Tips & Facts tab fetched and rendered
`GET /api/tips-facts`'s full historical list on load, and "Generate more"
appended a fresh batch of 5 on top of it — a backlog that only ever grew,
with no way to edit an entry (Share was the only action). Per updated
direction, this tab should never pile up into a scrollable backlog, and
it needed editing.

**Fix, in three parts:**

1. **Clean starting state, one item at a time.** `pages/TipsFacts.jsx` no
   longer calls `GET /api/tips-facts` on load at all. It now opens on
   `<TipsFactsEmptyState>` ("Generate a tip or fact") and holds at most
   one tip/fact in memory (`item`, not an array) — generating always
   **replaces** whatever's currently shown, it never appends. This is
   the exact same shape R3 already established for Create's `result`
   state (single value, replaced on every successful Generate — see that
   section above); Tips & Facts now follows the same pattern for the
   same reason.
2. **Single-item generation.** `POST /api/tips-facts/generate` already
   supported an optional `count` parameter before this prompt — it was
   fully plumbed through `routes/tipsFacts.js` → `services/
   tipsFactsGenerator.js`'s `validateOptions()` → the Gemini prompt
   itself (`Generate exactly ${count} short items.`), just never called
   with anything other than the default. **No backend change was needed
   here** — only `api/tipsFactsApi.js` → `pages/TipsFacts.jsx` now
   explicitly requesting `count: 1` on every generate call, so exactly
   one tip/fact comes back (or zero, if Gemini had nothing confident to
   add — see the empty-response note below) instead of a batch of 5.
3. **New Edit capability.** `tips_facts` had no PATCH/edit endpoint
   before this prompt — Share was the card's only action. Added
   `PATCH /api/tips-facts/:id` (see "New backend endpoint" below) and
   gave `components/tipsfacts/TipFactCard.jsx` an Edit action alongside
   the existing Share action, following the same self-contained Edit
   pattern `components/feed/CarouselCard.jsx` uses (own editing state,
   own draft value, Save/Cancel, a status line, and an `onItemUpdate`
   callback so the parent can merge the saved row in place) — the same
   pattern R3 already reused for Create, now extended to a third screen
   for visual/behavioral consistency across all three.

**New backend endpoint — `PATCH /api/tips-facts/:id`:**
- Authenticated (`requireAuth`, same as the existing two `tips-facts`
  routes).
- Body: `{ content: string }` — the only editable field. Rejects a
  missing/empty `content` with 400, same validation style as
  `PATCH /api/cards/:id`'s caption/title checks.
- Updates the row's `content` column directly (no other columns
  touched) and returns `{ tipFact: <updated row, camelCase> }`, shaped
  identically to an entry in `GET /api/tips-facts`'s array.
- 404 (`Tip/fact not found.`) if `:id` doesn't match any row; 400
  (`Invalid tip/fact id.`) if `:id` isn't a valid UUID — same
  Postgres-error-code handling `PATCH /api/cards/:id` already uses.
- **"Save" here is just this PATCH, nothing more:** generating already
  inserts the draft row (`services/tipsFactsGenerator.js`'s
  `insertTipsFacts()`), so Edit's "save" only ever needs to update that
  same row's `content` in place — there's no separate explicit save step
  and nothing else to persist.

**Backend — changed files:**
- `src/routes/tipsFacts.js` — added the `PATCH /:id` handler above;
  expanded the file's header comment to document all three endpoints
  (including that `count` already existed and needed no change).
  `POST /generate` and `GET /` themselves are byte-for-byte unchanged.
- `src/services/tipsFactsGenerator.js` — **not modified.** `count` was
  already a fully-supported option; confirmed by reading
  `validateOptions()` and `buildPrompt()` before starting this prompt,
  rather than assuming it needed adding.

**Frontend — changed files:**
- `pages/TipsFacts.jsx` — rewritten: dropped the on-load
  `GET /api/tips-facts` fetch, the `items` array, and the skeleton-list
  loading state entirely; now holds a single `item`, shows
  `<TipsFactsEmptyState>` when there isn't one, and shows one
  `<TipFactCard>` + a "Generate another" button when there is. Every
  generate call passes `count: 1`.
- `api/tipsFactsApi.js` — added `updateTipFact()` (`PATCH
  /api/tips-facts/:id`); doc comments updated to reflect all three
  calls and that the list call is no longer used on load.
- `components/tipsfacts/TipFactCard.jsx` — added the Edit action
  (self-contained editing state, `updateTipFact()` on save, `onItemUpdate`
  callback) alongside the existing Share action; restructured from a
  compact horizontal row (content + a bare icon button) to a vertical
  layout (label → content-or-edit-form → an Edit/Share action row),
  matching `<CarouselCard>`'s shape.
- `components/tipsfacts/TipsFactsEmptyState.jsx` — copy updated for the
  new "starting state, not just a rare zero-state" role this component
  now plays; behavior (`onGenerate`/`generating` props, calls
  `POST /api/tips-facts/generate` directly) unchanged.
- `pages/tipsfacts.css` — reworked `.tip-fact-card*` rules for the new
  vertical layout and added `.tip-fact-card-actions` /
  `.tip-fact-card-edit` / `.tip-fact-card-edit-actions` (mirroring
  `.carousel-card-actions` / `.carousel-card-edit` /
  `.carousel-card-edit-actions` in `feed.css` for visual consistency);
  removed the now-unused `.tips-facts-list` / `.tip-fact-card-share`
  rules; simplified `.tips-facts-error` to a single inline line (no more
  full blocking error screen with its own "Try again" button — there's
  no list-fetch to retry anymore, just the same Generate button).

**Explicitly NOT modified:** Feed, Create, and History — all of their
pages, components, and CSS — are untouched, per the prompt.
`GET /api/tips-facts` itself is untouched and still callable; it's just
no longer called from `TipsFacts.jsx`'s initial load.

**⚠️ Before going live — leftover test data:** the `tips_facts` table
almost certainly has draft rows left over from development/testing
(manually-triggered generates while building Phases 3–4 and this
Redesign prompt). This UI change doesn't hide or filter that data away —
it simply stops *fetching the list* on load, so old rows are invisible
in the app either way, but **they are still sitting in the table**. If
you plan to keep using this Supabase project for real, go into the
Supabase dashboard's Table Editor (or run a `DELETE FROM tips_facts;` in
the SQL Editor) and clear it out yourself before treating the app as
"live" — **this was intentionally not done automatically as part of this
prompt.**

**Manual test checklist:**
1. Open the Tips & Facts tab fresh (or reload it). Confirm it shows the
   "Generate a tip or fact" empty state immediately — no fetch, no list,
   no skeleton rows.
2. Tap "Generate a tip or fact." Confirm exactly ONE card appears (not a
   batch of 5), correctly labeled Tip or Fact.
3. Tap "Generate another." Confirm the card is REPLACED by a new one —
   nothing stacks or appends.
4. Tap Edit on a card. Confirm it opens the content as an editable
   textarea with Save/Cancel. Change the text and Save — confirm the
   card updates in place and the change persists (reload the page,
   generate is fine — full persistence check is via Supabase's Table
   Editor: confirm the row's `content` column reflects the edit).
5. Tap Share on a card. Confirm the native share sheet (or clipboard
   fallback) fires with the current (possibly just-edited) content.
6. Confirm Feed, Create, and History all look and behave exactly as they
   did before this prompt.

## Redesign Phase — R5: History — Core Archive List

**Why this prompt exists:** R2 rebuilt Feed into a fixed 6-card
carousel — the "N most recent updates," not a browsable queue. That
means History is now the *only* screen where a user can see everything
they've ever generated. This prompt rebuilds History into that role: the
full combined archive, paginated so it never tries to render an
unbounded list at once. Search and filters are a deliberately separate
prompt (R6) — this one is core-list-only.

**1. The full combined archive, no `sourceType` split.**
`GET /api/cards` (unchanged this prompt — see "Backend" below) has never
had a `sourceType` filter at all; it only ever filters by `topic`,
`status`, and `search`. History now calls it with `status: 'all'` and no
`topic`/`search`, so every card — auto-pipeline *and*
manually-created (Create tab), every status (draft/approved/skipped) —
comes back in one newest-first stream. There was never a need to
"merge two lists together"; it was always one `cards` table, and the
only thing standing between "the full archive" and "Feed's draft-only
default" was which query params got sent. (Tips & Facts remains a
separate table/tab, not part of this archive — see R4.)

**2. Backend: already sufficient, extended nothing.** Before touching
anything, `routes/cards.js` was read end-to-end: `GET /api/cards`
already supported `status=all` (added Phase 4, Prompt 2, confirmed still
working via R2's Feed carousel change) and offset/limit pagination
(`limit` default 20, capped at `MAX_LIST_LIMIT = 50`; `offset`/`hasMore`/
`nextOffset` in the response) — both already built for the old
pre-redesign History tab and the Feed carousel's `limit=6`. Nothing
about "list everything, paginated" was actually missing, so **no backend
files changed in this prompt** — `src/routes/cards.js` is byte-for-byte
untouched. This is the same "check before extending" pass R4 did for
`tips_facts`'s `count` param.

**3. Pagination approach: infinite scroll (not numbered pages).**
Same choice, and the same reasoning, as the old pre-carousel Feed list
used (see the "Redesign Phase, Prompt 2" / old Phase 4, Prompt 2
sections above): an `IntersectionObserver` watches a sentinel `<div>`
at the bottom of the list and fetches the next page of `PAGE_SIZE = 20`
cards when it scrolls into view, appending to the in-memory `cards`
array. This is the standard pattern for an archive a user scrolls
through casually rather than jumps to a specific page number of, and it
means the DOM only ever holds however many pages the user has actually
scrolled past — not the full archive at once, however large it grows.
`hasMore`/`nextOffset` from the API response drive when to stop
observing; a request-id ref guards against a stale response landing
after a newer one (a leftover-but-harmless safety net now that there are
no filters left to trigger a reset mid-session — see point 5).

**4. Layout: compact list, not a carousel.** Reused
`components/history/HistoryListItem.jsx`, which already existed in the
codebase from the old pre-redesign History tab and already matched the
spec almost exactly — 40px thumbnail, single-line headline, muted
uppercase meta line — so it was extended rather than rebuilt from
scratch. (The Feed carousel's `<CardListItem>`/`<CardActions>` pair,
Phase 4's *original* list-item style, was also checked — it's still
alive and well, just now exclusively used by Create — but it's a bigger,
caption-and-enrichment-showing row built for an active review queue, not
this scannable archive's smaller footprint, so `HistoryListItem` was the
closer match.) The row's meta line was trimmed to topic + relative time
(dropped the old inline status word — status still comes back, as a
filter, in R6). `HistoryListItemSkeleton.jsx` was updated to match the
new internal `.history-item-row` wrapper (added so a Share status
message can sit on its own line underneath without fighting the row's
`align-items: center`).

**5. Actions: Share only, no Edit.** `HistoryListItem` had no actions at
all before this prompt (the old History tab was pure read-only). Added
exactly one — an icon-only Share button — reusing `utils/shareCard.js`
completely unmodified, the same image-then-text-then-clipboard fallback
chain `CarouselCard`'s Share already uses. No Edit: per spec, History is
a settled record of what already happened, not an active editing
surface — Edit stays on Feed (`CarouselCard`), Create (same component),
and Tips & Facts (`TipFactCard`), all of which show *freshly generated*
content. No Approve/Skip either — those never existed on this row to
begin with (they were always a Feed-only concept, now gone from Feed too
per R2).

**6. Search/filters explicitly deferred to R6.** The old (pre-redesign)
History page had a debounced search box plus `StatusFilter`/
`TopicFilter` pill rows. Both filter components
(`components/history/StatusFilter.jsx`, `components/feed/
TopicFilter.jsx`) and their backing config (`config/statuses.js`) are
left in the codebase completely untouched — R6 will re-wire them — but
`pages/History.jsx` no longer imports or renders any of them, and no
longer tracks `topic`/`status`/`search` state or sends those query
params. This also simplified the empty state: there's only one case now
("No history yet"), not a second "no results for your filters" variant —
that comes back in R6 alongside the filters themselves.

**7. Empty state.** `HistoryEmptyState.jsx` (existed already, simplified
this prompt — see point 6) renders when the archive has zero cards: a
brand-new account with nothing in the `cards` table yet, from either the
auto-pipeline or manual Create.

**Frontend — changed files:**
- `pages/History.jsx` — rewritten: dropped the search box, `StatusFilter`,
  `TopicFilter`, and all `topic`/`status`/`search` state/query params;
  now always fetches `status: 'all'` (every topic, every status) via the
  same offset-based infinite-scroll loop the old version already had.
- `components/history/HistoryListItem.jsx` — added the Share action
  (icon button + status line), wrapped the thumb/body/button row in a
  new `.history-item-row` div so the card can stack a status message
  underneath.
- `components/history/HistoryListItemSkeleton.jsx` — updated to match
  the new `.history-item-row` wrapper and added a 32px placeholder block
  for the Share button, so loading → loaded doesn't jump.
- `components/history/HistoryEmptyState.jsx` — simplified to the single
  always-true-empty case (dropped the `filtered` prop/branch — see point
  6).
- `pages/history.css` — `.history-item` now stacks vertically (row, then
  an optional status line) instead of being the row itself; added
  `.history-item-row` (the old row layout, unchanged), `.history-item-
  share-btn`, and `.history-item-status`; removed the now-unused `.history-
  filters` rule.

**Backend — changed files:** none. `src/routes/cards.js` was read in
full and confirmed already sufficient (see point 2) — not modified.

**Explicitly NOT modified:** Feed, Create, and Tips & Facts — all of
their pages, components, and CSS — are untouched, per the prompt.
`components/history/StatusFilter.jsx`, `components/feed/TopicFilter.jsx`,
and `config/statuses.js` are untouched but currently unused by any page
— staged for R6.

**Manual test checklist:**
1. Generate several cards across both auto-pipeline (if the schedule/cron
   is running) and manual Create, and approve/skip a few of them via the
   Feed carousel. Open History — confirm every one of those cards shows
   up, regardless of status or how it was created, newest first.
2. Confirm each row shows a small thumbnail (or the placeholder glyph
   for cards with no image), a single-line headline, and a muted
   "Topic · relative time" line — no caption, no enrichment note, no
   status word.
3. Confirm there's no search box and no filter pills on this screen.
4. Scroll to the bottom of a long list (20+ cards). Confirm more cards
   load in automatically (no "Load more" button, no page numbers) and
   the loading spinner in the sentinel area only appears while a page is
   actually in flight.
5. Tap Share on a History row. Confirm the native share sheet (or
   clipboard fallback) fires with that card's title/caption/image, and a
   brief status line appears underneath confirming it.
6. On a brand-new account with zero cards, confirm the "No history yet"
   empty state renders instead of an empty list.
7. Confirm Feed, Create, and Tips & Facts all look and behave exactly as
   they did before this prompt.

## Redesign Phase — R6: History — Search + Filters, Final Consolidation (Redesign Phase Complete)

The last prompt of the Redesign Phase. Adds search and filters to
History (deliberately deferred by R5), then does a final wiring-gap
check across everything R1–R5 built — the same discipline as Phase 3's
own final-consolidation prompt.

**1. Search — backend already had it, checked first.** `GET /api/cards`
has supported `?search=` (case-insensitive substring match against
title OR caption) since Phase 4, Prompt 5 — `routes/cards.js` was read
end-to-end before writing any code, and this was confirmed already
correct and unused by any current page. **No backend change was needed
for search.** `History.jsx` now sends it, debounced 400ms after the
person stops typing so every keystroke doesn't fire its own request.

**2. Filters — topic reused as-is, source type genuinely new.**
- **Topic** (Tech/Sports/Finance/Entertainment/General News/All):
  `components/feed/TopicFilter.jsx` already existed, already built on
  the Pill component, and was already left untouched-but-unused in the
  codebase since R5 specifically for this prompt to re-wire. Re-wired
  into `History.jsx` with zero changes to the component itself.
  `?topic=` has existed on `GET /api/cards` since Phase 4, Prompt 2 —
  no backend change needed here either.
- **Source type** (Auto-generated/Manually created/All): genuinely
  missing — R5's own writeup confirmed `GET /api/cards` "has never had
  a `sourceType` filter at all." Added one:
  - `backend/src/routes/cards.js` — new optional `?sourceType=` param.
    Every row's `source_type` column is one of `'reddit'` / `'rss'` /
    `'hackernews'` / `'generated-event'` (all auto-pipeline sources) or
    `'manual'` (`services/manualCreate.js`). Rather than hardcode/
    duplicate that auto-source list here, `'manual'` is the only
    distinguished value: `?sourceType=manual` → `.eq('source_type',
    'manual')`; `?sourceType=auto` → `.neq('source_type', 'manual')`
    ("anything that isn't manual" — so a future new auto source needs
    no change here); anything else (including omitted, or `all`)
    applies no filter. This is the only backend file touched this
    prompt.
  - `frontend/src/config/sourceTypes.js` (new) — `HISTORY_SOURCE_TYPES`,
    mirroring `config/topics.js`'s shape exactly.
  - `frontend/src/components/history/SourceTypeFilter.jsx` (new) — same
    Pill-row pattern as `StatusFilter`/`TopicFilter`, reusing the shared
    `.topic-filter` CSS class since the layout is identical.

  **`components/history/StatusFilter.jsx` and `config/statuses.js`
  (draft/approved/skipped) were intentionally left alone** — this
  prompt's spec calls for a topic filter and a source-type filter only,
  not a status filter. Both files remain exactly as R5 left them:
  untouched, in the codebase, unused by any page. (R5's own writeup
  speculated both filter components would come back in "R6" together —
  that turned out to only be true for `TopicFilter`; `StatusFilter`
  stays parked for a future prompt, if one ever wants it.)

**3. Combining search/filters with R5's infinite scroll.** Search and
both filters are just more query-param siblings of `topic`/`status` on
the same `GET /api/cards` call the infinite scroll already drives, so
the pagination mechanism itself (`IntersectionObserver` + sentinel +
offset/limit) didn't need to change. What did need to change:
`History.jsx`'s reset-triggering `useEffect` widened from "run once, on
mount" (all R5 left, since there was nothing to filter) to "run on
mount, and again whenever topic, source type, or the debounced search
term changes" — each of those calls `loadPage(0, { reset: true })`,
which was already written to *replace* `cards` rather than append to it
on `reset`. The existing `requestIdRef` staleness guard (already in
place since R5, previously more of a defensive leftover) now does real
work: typing quickly, or tapping filter pills back-to-back, fires
several overlapping requests, and only the response matching the
current `requestIdRef.current` gets applied — every earlier, now-stale
one is dropped instead of momentarily flashing onto the list or, worse,
getting concatenated onto a page that belongs to a different
query. Confirmed manually: filtering to a topic with under `PAGE_SIZE`
matching cards, then scrolling, does not fire a "load more" request
that fetches the *unfiltered* next page.

**4. Empty state, filtered variant restored.** `HistoryEmptyState.jsx`
gets its `filtered` prop back (removed by R5 when there was nothing to
filter by): "No history yet" for a genuinely-empty archive, "No matching
history" + a hint to adjust the search/filters when the archive has
cards but the current query matched none of them.

**Frontend — new files:**
- `config/sourceTypes.js` — `HISTORY_SOURCE_TYPES` (All / Auto-generated
  / Manually created).
- `components/history/SourceTypeFilter.jsx` — the source-type pill row.

**Frontend — changed files:**
- `pages/History.jsx` — rewritten: added `topic`/`sourceType`/
  `searchInput`/`search` state, a debounce effect for search, a
  `.history-filters` block (search input + `<TopicFilter>` +
  `<SourceTypeFilter>`) above the list, and widened the reset effect to
  depend on all three filter values (see point 3). `loadPage` now passes
  `topic`, `sourceType`, and `search` through to `getCards()`.
- `api/cardsApi.js` — `getCards()` gained a `sourceType` param, sent as
  `?sourceType=` unless it's `'all'`/omitted; doc comment updated.
- `components/history/HistoryEmptyState.jsx` — `filtered` prop restored
  (see point 4).
- `components/icons/Icons.jsx` — added `IconSearch` and `IconClose` for
  the new search input; every existing icon untouched.
- `pages/history.css` — added `.history-filters`/`.history-search*`
  rules for the new search box + filter row layout. Everything else in
  this file (the `.history-item*` rules from R5) is unchanged.

**Backend — changed files:**
- `src/routes/cards.js` — added the `sourceType` query param to
  `GET /api/cards` (see point 2). `PATCH /api/cards/:id` and every other
  part of this file are unchanged.

**Explicitly NOT modified this prompt:** `components/feed/TopicFilter.jsx`
(reused byte-for-byte), `components/history/StatusFilter.jsx`,
`config/statuses.js`, `components/history/HistoryListItem.jsx`,
`components/history/HistoryListItemSkeleton.jsx`, and every part of
Feed, Create, and Tips & Facts (pages, components, CSS) — all untouched,
per the prompt, beyond the consolidation fixes noted below.

### Final consolidation check (Redesign Phase, R1–R5)

Before finishing this prompt, every item R1–R5 built was re-verified
end-to-end rather than assumed still correct:

- **Nav — still exactly 4 items.** `components/layout/BottomNav.jsx`'s
  `NAV_ITEMS` is still exactly Feed/Create/Tips & Facts/History.
  `components/layout/ProfileMenu.jsx` still puts Settings/Account/
  (admin-only) Admin Panel behind the top-right avatar menu, and
  `App.jsx` still routes `/settings`, `/account`, `/admin` directly so
  deep links keep working, with `AdminRoute` still bouncing non-admins
  away from `/admin`. **No issue found; no change made.**
- **Feed carousel — still works.** `pages/Feed.jsx` still fetches
  exactly `GET /api/cards?status=all&limit=6`;
  `components/feed/CardCarousel.jsx`'s wrap-around index math
  (`((next % count) + count) % count`) still loops correctly past
  either end; `components/feed/CarouselCard.jsx` still renders Edit +
  Share only (no Approve/Skip) and still genuinely renders the
  enrichment note (split on `" | "`) when a card has one. **No issue
  found; no change made.**
- **Create — still shows full enrichment.** `pages/Create.jsx` still
  renders its `result` through the same unmodified `<CarouselCard>`, so
  headline, caption, and (when present) the two enrichment-note lines
  all still display after generating, with Edit + Share only. **No
  issue found; no change made.**
- **Tips & Facts — still one at a time, Edit still works.**
  `pages/TipsFacts.jsx` still calls `generateTipsFacts({ token,
  count: 1 })` and still holds a single `item` (replaced, not
  appended) on every generate; `PATCH /api/tips-facts/:id` and
  `components/tipsfacts/TipFactCard.jsx`'s Edit action are both still
  in place and unchanged. **No issue found; no change made.**
- **Fallback images — still monochrome, still actually loading.**
  `backend/src/services/imageHandler.js`'s `buildSvg()` still uses only
  the four monochrome tokens (`#141414` surface / `#ffffff` text /
  `#8a8a8a` muted / `#2a2a2a` border) copied from
  `frontend/src/styles/tokens.css` — no `TOPIC_COLORS`-style color logic
  has crept back in. `backend/server.js` still serves
  `app.use('/generated', express.static(.../backend/public/generated))`
  pointed at the exact same directory `imageHandler.js`'s `OUTPUT_DIR`
  writes to, and `sharp` (`^0.35.4`) is a real, installable version, not
  a typo'd/nonexistent one. Verified every backend file (including this
  one) still parses cleanly, and ran a full frontend production build
  (`vite build`) to catch any dangling import broken by an earlier
  prompt — **both passed cleanly. No issue found; no change made.**

**No breakage was found anywhere in R1–R5's work.** This consolidation
pass is therefore a confirmation, not a bug-fix list — every item above
was independently re-checked against the current code (not just
re-read from earlier README sections) before being marked "no change."

### Redesign Phase Complete

All 6 Redesign Phase prompts are now done:

1. **R1** — navigation verified (already correct, no change), fallback
   images fixed from per-topic color to strict monochrome.
2. **R2** — Feed rebuilt from an infinite-scroll list into a 6-card
   carousel (Edit + Share only, wrap-around navigation, swipe + arrow
   controls).
3. **R3** — Create tab now shows the full enrichment note (context +
   suggested angle) after generating, by reusing R2's `<CarouselCard>`.
4. **R4** — Tips & Facts no longer piles up: one item in memory at a
   time, `count: 1` per generate, replaced (not appended) on each
   "Generate another," plus a new Edit action.
5. **R5** — History rebuilt into the full combined card archive (every
   status, every source, auto-pipeline and manual together), paginated
   via infinite scroll, Share-only actions, a single empty state.
6. **R6 (this prompt)** — History gained free-text search and topic/
   source-type filter pills, correctly combined with R5's infinite
   scroll (filter/search changes reset to page 0 and replace results,
   never silently merge), plus this final consolidation pass confirming
   R1–R5 are all still intact.

**Confirmed end-to-end:** the bottom nav's 4 tabs (Feed, Create,
Tips & Facts, History) and the 3 profile-menu tabs (Settings, Account,
Admin — admin-gated) all still route correctly and render their
Redesign Phase content as described above. Auth (login/signup/session)
and the backend pipeline/schedule/cron machinery underneath all of this
are untouched by the Redesign Phase entirely.

**Phase 5 is next: PWA installability** — a `manifest.json`, a service
worker, and the "Add to Home Screen" flow, turning the Vite React app
into a genuinely installable PWA. No Redesign Phase file changes above
touch anything Phase 5 will need to add.

---

## Phase 5 — Prompt 1: App icons + `manifest.json`

Phase 5 makes the existing app **installable** (Add to Home Screen). It adds no
features and changes no tab/page behaviour. This first prompt covers the icon
set, the web app manifest, and the `<head>` links that point at them. The
service worker is the next prompt.

### Icon design choice

One mark, three readings — deliberately abstracted rather than a literal
drawing of three objects, because app icons are mostly seen at 40–60px:

| Element | What it reads as |
| --- | --- |
| Circle on an angled handle | A magnifying glass (investigative, "getting the scoop") **and** an ice-cream scoop — the two objects share one silhouette, which is what lets the mark carry both ideas without drawing either twice |
| Three stacked bars inside the circle | Newspaper headline lines; the short third line stops it reading as a generic "menu" or "equals" glyph and matches the Feed tab icon's existing bar language |

Everything is white line-art on a flat background, drawn with round caps and
joins to match `frontend/src/components/icons/Icons.jsx`. Colours are taken
directly from `frontend/src/styles/tokens.css` — no new values introduced:

- Background: `#000000` (`--color-bg`)
- Line art: `#ffffff` (`--color-text`)

Legibility was the constraint that drove the geometry: heavy strokes
(26px ring / 24px bars on a 512 canvas), only three interior lines, and a
separate simplified `favicon.svg` that drops to **two** bars with
proportionally heavier strokes so it survives 16–32px in a browser tab.

### Files added — `frontend/public/`

| File | Size | Purpose |
| --- | --- | --- |
| `icon.svg` | vector | Master mark, full-bleed background |
| `icon-maskable.svg` | vector | Same mark, scaled into the Android safe zone |
| `favicon.svg` | vector | Simplified two-bar mark for tiny sizes |
| `icon-192.png` | 192×192 | PWA icon, `purpose: any` |
| `icon-512.png` | 512×512 | PWA icon / splash, `purpose: any` |
| `icon-512-maskable.png` | 512×512 | PWA icon, `purpose: maskable` |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `favicon-32.png` | 32×32 | PNG favicon |
| `favicon.ico` | 16/32/48 | Legacy favicon (multi-resolution) |
| `manifest.json` | — | Web app manifest |

PNGs are rendered from the SVG sources, so the vectors stay the single source
of truth — re-export from `icon.svg` / `icon-maskable.svg` / `favicon.svg` if
the mark is ever revised.

#### Maskable safe zone

Android crops home-screen icons into a circle, squircle, rounded square or
teardrop, so `icon-512-maskable.png` follows the maskable spec: the background
is full-bleed (no transparent corners can ever show), and the artwork is scaled
to **0.85** of the base mark so its entire bounding box sits inside the 80%
safe zone — a centred circle of radius 204.8px on a 512px canvas.

Verified: the furthest white pixel from centre is **198.0px**, inside the
204.8px safe radius. Nothing is clipped by any mask shape.

### `manifest.json` validation

All required and recommended installability fields are present:

| Field | Value |
| --- | --- |
| `name` | `Scoopr` |
| `short_name` | `Scoopr` |
| `description` | Multi-topic news aggregator with AI-polished shareable cards |
| `id` | `/` |
| `start_url` | `/` (matches the `RootRedirect` route in `App.jsx`) |
| `scope` | `/` |
| `display` | `standalone` |
| `orientation` | `portrait` |
| `background_color` | `#000000` |
| `theme_color` | `#000000` |
| `icons` | 192 `any`, 512 `any`, 512 `maskable`, plus the SVG |

Checked: the JSON parses, `display` is a valid value, a 192×192 and a 512×512
`any` icon and a `maskable` icon are all present, and every `src` in the
`icons` array resolves to a file that actually exists in `frontend/public/`.
`background_color` and `theme_color` both match `--color-bg` and the existing
`<meta name="theme-color">` already in `index.html`.

> Chrome's installability bar needs one more thing that this prompt does not
> add: a registered service worker with a fetch handler. Lighthouse will still
> flag that until Phase 5 Prompt 2 lands — the manifest half is complete.

### `frontend/index.html` changes

Added to `<head>` only — no existing tag was removed or altered:

- `<link rel="manifest" href="/manifest.json">`
- `<link rel="icon">` × 3 (`.ico`, 32px PNG, SVG)
- `<link rel="apple-touch-icon" sizes="180x180">`
- Apple/mobile web-app meta tags (`-capable`, `-title`, `-status-bar-style`)
- A `description` meta tag matching the manifest

The pre-existing `<meta name="theme-color" content="#000000">` already matched
the manifest's `theme_color`, so it was left as-is.

### Scope note

No backend file was touched. No file under `frontend/src/` was touched — every
route, tab and page behaves exactly as it did at the end of the Redesign Phase.
Vite serves `frontend/public/` at the web root automatically and copies it into
`dist/` on build, so the absolute `/manifest.json` and `/icon-*.png` paths
resolve in both dev and production with no `vite.config.js` change.

## Phase 5 — Prompt 2: Service Worker + Install Prompt + Testing Checklist

The last prompt of Phase 5. Adds the one piece Prompt 1's own scope note
flagged as missing: a registered service worker with a fetch handler —
without one, Chrome will not offer to install the app at all, no matter how
correct `manifest.json` is. Also adds a deliberate, custom "Install Scoopr"
UI (rather than relying on the browser's own easy-to-miss install icon), and
closes out Phase 5 with a manual device-testing checklist.

Nothing from Prompt 1 was touched: `manifest.json`, every icon file, and
`index.html` are all exactly as they were.

### Why a hand-written service worker (not `vite-plugin-pwa`)

Went hand-written. `vite-plugin-pwa` is a completely reasonable choice for a
bigger app, but for Scoopr's actual requirement here — cache the app shell,
categorically never cache the API — a plugin adds a new build-time
dependency, a Workbox config surface, and a generated file to reason about,
in exchange for automating something that's about 60 lines of plain,
readable `fetch` handling. Hand-writing `sw.js` directly means:

- **Nothing to misconfigure.** The plugin's `workbox.runtimeCaching` rules
  are pattern-matched and easy to get subtly wrong (e.g. a glob that
  accidentally also matches an API route). A hand-written `fetch` handler
  makes the "never cache `/api/*` or any cross-origin request" rule a single
  explicit `if` at the top, impossible to apply to the wrong requests.
- **No new dependency** for a personal project that already has a minimal,
  intentional `package.json` (Prompt 1 didn't add one for the same reason).
- **Nothing to regenerate.** A plugin-generated service worker's output
  changes with plugin/Workbox version bumps; a hand-written 90-line file
  changes only when someone deliberately edits it.

The trade-off: no automatic precaching of every hashed build asset by
filename. Not needed here — see the caching strategy below, which caches
assets as they're actually requested rather than off a precache manifest.

### `frontend/public/sw.js` — caching strategy

Deliberately simple, and safe for a live-content app:

| Request | Strategy |
| --- | --- |
| Non-`GET` (login, logout, card actions, admin actions, …) | Not intercepted — straight to network, always |
| Cross-origin (the backend API at `VITE_API_BASE_URL`, Google Fonts, …) | Not intercepted — straight to network, always |
| Same-origin `/api/*` (defense in depth, in case of a future reverse-proxied deploy) | Not intercepted — straight to network, always |
| Page navigation (loading/refreshing a route) | Network-first, falling back to the cached shell only if the network request fails (offline) |
| Same-origin static assets (hashed JS/CSS bundles, icons, fonts) | Stale-while-revalidate — serve the cached copy instantly if present, refresh the cache from the network in the background |

The middle three rows are the important guarantee this prompt asked for:
cards, tips/facts, auth state, schedule settings, admin data — anything
that comes from the backend — is **never** written to the Cache Storage
this service worker manages, so there's no path by which a user could see
stale news. Only the static shell (what loads the app, not what the app
displays) is ever cached.

`CACHE_NAME` is versioned (`scoopr-shell-v1`) and the `activate` handler
deletes any other cache under that name, so bumping the version string is
the mechanism for forcing every client to drop old cached shell assets the
next time the service worker updates.

### Registration — `frontend/src/utils/registerServiceWorker.js`

Called once from `main.jsx`, after `ReactDOM.createRoot(...).render(...)` —
registration never sits in front of or blocks the initial render:

```js
registerServiceWorker();
```

Defensive by design, per this prompt's spec:

- Checks `'serviceWorker' in navigator` first; on an unsupported browser
  it returns immediately and does nothing else.
- Registration itself happens inside `window.addEventListener('load', ...)`
  so it never competes with initial page resources.
- The `.register('/sw.js')` call is wrapped in `.catch(...)` — a failure
  logs a single `console.warn` and nothing else happens. No error is
  thrown up to React, no UI changes, no blocked render.

### Install prompt — `InstallPromptContext` + `InstallBanner` + Account tab

Three new pieces work together:

1. **`frontend/src/context/InstallPromptContext.jsx`** — added to the
   provider tree in `main.jsx` (wraps `AuthProvider`). Listens for the
   browser's `beforeinstallprompt` event once, calls `event.preventDefault()`
   to suppress the browser's own mini-infobar, and stores the deferred
   event in state so it can be triggered later from Scoopr's own UI rather
   than at the arbitrary moment the browser would otherwise show it. Also
   listens for `appinstalled` and checks `(display-mode: standalone)` /
   `navigator.standalone` up front, so an already-installed session never
   shows install UI. Exposes `canInstall`, `isInstalled`, and
   `promptInstall()` via the `useInstallPrompt()` hook.
2. **`frontend/src/components/layout/InstallBanner.jsx`** — mounted at the
   top of `AppShell`'s content area (so it appears above Feed/Create/Tips &
   Facts/History/Settings/Account, whichever tab is active). Renders
   nothing at all unless `canInstall` is `true` — i.e. unless the browser
   has actually fired `beforeinstallprompt`. Dismissible (×); the dismissal
   is remembered in `localStorage` for 7 days so it doesn't nag every
   session, then reappears in case the moment wasn't convenient the first
   time.
3. **Account tab (`Account.jsx`)** — a second, permanent entry point: an
   "Install app" card with an "Install Scoopr" button, for anyone who
   dismissed the banner (or just prefers to install from Account). Same
   `canInstall` guard — renders nothing if the browser never offered an
   install prompt, so there's no dead/broken button for iOS Safari or an
   already-installed PWA.

**The "browser doesn't fire `beforeinstallprompt`" case** (Safari on iOS,
an already-installed app, some third-party/embedded browsers) is handled by
construction, not a special-cased check: both the banner and the Account
button are driven off the same `canInstall` boolean, which starts `false`
and only ever flips to `true` in response to a real browser event. No event
firing means neither piece of UI renders — never a button that does
nothing when tapped.

### Manual test checklist

Can't be verified by generated code — installability is a real
browser/device behavior, not something this environment can execute. Run
through this on an actual phone once the app is deployed (or over
`localhost` for a quick sanity check first):

1. Serve the app over a secure context — either `localhost` (dev) or a
   real HTTPS deployment (Render). PWA install is refused entirely over
   plain HTTP on a non-localhost origin.
2. Open the app in Chrome on Android, or Safari on iOS.
3. Confirm an install affordance appears: Scoopr's own "Install Scoopr"
   banner/button, and/or the browser's native install icon (Chrome) or
   "Add to Home Screen" option (Safari, via the Share sheet).
4. Tap install / Add to Home Screen and confirm it completes without
   error.
5. Open the installed app from the home screen icon and confirm it
   launches **standalone** — no browser address bar or tab UI.
6. Confirm the home screen icon and app name ("Scoopr") look correct.
7. From the installed (standalone) app, confirm core flows still work:
   log in, view the Feed, open Create and generate/approve a card.
8. Optional: turn on airplane mode after the app has loaded once, then
   relaunch the installed app — the shell should still load (blank/offline
   only past that point, since API calls are intentionally never cached).

## Phase 5 Complete

Phase 5 (installability) is done: app icons + `manifest.json` (Prompt 1)
plus a service worker, custom install prompt, and this testing checklist
(Prompt 2) are all in place. This is the last planned phase — Scoopr is now
feature-complete and installable as a PWA, pending the checklist above
being run manually on a real device and eventual deployment to Render.
