# Cached disaster searches + nightly 2am refresh

Today every "Disaster areas" search calls the AI model, which is slow and burns credits. This adds a stored cache so a search done today is reused, plus a nightly job that pre-warms it so the list opens instantly.

## What changes for the user

- Opening the disaster sheet shows results immediately when a cached search for that filter exists from today.
- A small line notes when the list was last refreshed, with a "Refresh" action to force a fresh search.
- Every night at 2:00am New York time the six filters (Any, Wildfire, Flood, Hurricane, Landslide, Earthquake) are refreshed in the background.
- The list is populated once right away as part of this work, so it is not empty before the first nightly run.

## Behaviour

- Cache key: disaster type filter plus the normalized free-text query (empty for the plain filter searches).
- Reads: if a cached row for that key was fetched on the current New York day, return it without calling the AI. Otherwise search, store, return.
- Free-text queries are cached too, under the same day rule.
- Refresh button bypasses the cache and overwrites the stored row.
- If the AI call fails but a stale cached row exists, the stale row is returned with a "may be out of date" note rather than an error.

## Technical notes

Backend: enable Lovable Cloud (database + scheduled jobs). No user accounts are involved; the cache is public read-only data.

Schema (one migration, with grants):

- `disaster_searches` — `id`, `filter_type`, `query_key` (normalized text, `''` for none), `events` jsonb, `fetched_at` timestamptz, `ny_day` date, unique on (`filter_type`, `query_key`). `GRANT SELECT` to `anon`/`authenticated`, `ALL` to `service_role`; RLS on with a `TO anon, authenticated` SELECT policy; writes only via service role.
- `job_state` — single row per job (`disaster_refresh`): `status`, `paused_reason`, `lease_until`, `last_run_at`. Not readable by `anon`.

Server code:

- `src/lib/disaster-news.functions.ts`: extract the existing AI call into a reusable helper, and wrap `searchDisasters` with cache read → miss → AI → upsert (upsert via the service-role client loaded inside the handler). Add a `force` input for the Refresh button, and return `{ events, fetched_at, stale }`.
- `src/routes/api/public/refresh-disasters.ts`: POST route for the scheduler. Requires a shared secret header (stored as a project secret) before doing any work. Reads `job_state` first and exits while paused; takes a single-flight lease; refreshes the six filter presets sequentially with a per-run cap; marks each filter done as it completes so a re-run skips finished ones; halts and persists a paused state on AI gateway 402/403 and after repeated 429s.
- Schedule with pg_cron at 06:00 and 07:00 UTC (covers 2am New York in both EDT and EST); the handler no-ops when the current New York day was already refreshed, so only one of the two fires actual work.

Frontend (`ShapeSwapMap.tsx`): consume the new return shape, show the "Updated <time>" line and Refresh button in the disaster sheet. No change to drawing, rotation or comparison behaviour.

MCP (`src/lib/mcp/tools/search-disaster-areas.ts`) goes through the same cached path, then the manifest is re-extracted.

Initial population: after the migration and route exist, the refresh endpoint is invoked once directly so the six filters are cached immediately, and the result is verified by reading the stored rows.

## Caveats

- Cached results are at most one day old by design; the Refresh button is there when something just happened.
- The model's knowledge of very recent events still lags real-time reporting; caching does not change that.
