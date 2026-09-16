# Real disaster data from ReliefWeb instead of AI recall

## Why that flood is missing

The disaster list is not a news feed. Each entry is written by the AI model from what it remembers, then cached for the day. The model's knowledge stops well before today, so a report filed on ReliefWeb this week cannot appear — and today's cached "hurricane" and "landslide" lists are still full of 2022-2024 events for the same reason. Some entries also can't be traced back to a real report at all.

## The fix

Switch the source of truth to ReliefWeb's public disaster API (the same site as the link) and use the AI only to fill in the affected-area figure, which ReliefWeb doesn't always publish as a number.

What the user sees:

- The list becomes genuinely current — the Philippines flood (and anything else filed recently) shows up.
- Each event links out to its ReliefWeb page, so figures are checkable.
- Newest first, same type filters (Any, Wildfire, Flood, Hurricane, Landslide, Earthquake).
- Events whose affected area can't be established are shown with the area marked as "not reported" and can't be drawn on the map, rather than being silently dropped or given an invented number.
- The daily cache, the "Updated …" line, the Refresh button and the nightly 2am New York job all stay as they are.

## How it works

1. Fetch recent disasters from ReliefWeb: id, name, type, country, date, coordinates, status, and the report body.
2. Map ReliefWeb disaster types onto the app's six filters.
3. For each event, extract the affected-area figure (hectares/km²/acres) from the report text. Where the text states no area, ask the AI for one *for that named event only*, with an explicit instruction to answer "unknown" rather than guess.
4. Cache the assembled list per filter for the New York day, exactly as now.

## Technical notes

- `src/lib/disaster-news.server.ts`: replace `fetchDisastersFromAI` with a ReliefWeb fetch (`https://api.reliefweb.int/v2/disasters`, `appname` set, filtered on disaster type and `date.created` within the last 12 months, sorted descending, `limit` ~40) plus an area-extraction step. Keep `getDisasters`, the cache read/write, `nyDay`, job state and `refreshDisasterPresets` unchanged.
- `DisasterEvent` gains `url` (ReliefWeb page) and allows `area_value: null` for unknown-area events; `eventAreaM2` and `dateSortKey` stay.
- Area extraction: regex pass over the report summary for figures like "12,000 hectares" / "3 500 km2" / "flooded X barangays"; AI fallback per event, batched in one request, `null` when unknown.
- The AI gateway path stays behind the same 402/403/429 handling, so a credit failure degrades to ReliefWeb events with unknown areas instead of failing the whole list.
- `src/components/ShapeSwapMap.tsx`: show the source link, render "not reported" areas, and disable the draw action for those events.
- Mirror the shape change in `src/lib/mcp/tools/search-disaster-areas.ts`, then re-extract the MCP manifest.
- After the change, clear the six cached rows and run the refresh endpoint once so the lists repopulate from real data immediately, then verify the Philippines flood appears under Flood.

## Caveats

- ReliefWeb publishes disasters it tracks; very local events without an international response may not be listed.
- Affected-area numbers are only as good as the underlying reports; some events will legitimately stay "not reported".
