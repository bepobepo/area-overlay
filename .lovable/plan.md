# Draw with AI

## UI changes (`src/components/ShapeSwapMap.tsx`)

In the `idle` bottom sheet:
- Rename existing button "Draw a shape" → **"Draw on map"**.
- Add a second button **"Draw with AI"** (secondary style) next to / below it.

Clicking "Draw with AI" opens a modal dialog (simple overlay, no new shadcn dep needed) with:
- Textarea: "Describe an area or object (e.g. 5 shipping containers, a football pitch, a Boeing 747)".
- Buttons: Cancel · Generate.
- Loading state while the AI call runs; error message on failure.

On success:
- The returned polygon is placed centered on the current map view center.
- App transitions to `locked` mode with `originalRing` set (same flow as finishing a manual drawing), so the user can then search a location to overlay it elsewhere.
- Map fits bounds to the new shape.

## AI server function (`src/lib/ai-shape.functions.ts`, new)

`generateShape` — `createServerFn({ method: "POST" })`:
- Input (zod): `{ description: string }`.
- Uses Lovable AI Gateway via the shared helper (`src/lib/ai-gateway.server.ts`, create if missing) with `openai/gpt-5.5` and `structuredOutputs: true`.
- Prompt instructs the model to:
  1. Estimate the real-world footprint of the described thing in meters (length × width, or approximate area/shape).
  2. Return a simple polygon as an array of `[x, y]` points **in meters, relative to (0,0) centroid** — so we can place it anywhere on the map.
  3. Include a short `label` and estimated `area_m2` for display/debug.
- Schema (kept small/flat, no bounds; enforce counts in prompt + clamp in code):
  ```
  { label: string, area_m2: number, points_m: Array<{ x: number, y: number }> }
  ```
- Wrapped in the `NoObjectGeneratedError` guard from the gateway skill; falls back to parsing `error.text`.

## Client-side conversion

New helper in `ShapeSwapMap.tsx` (or `src/lib/geo.ts`):
- `metersPolygonToLngLat(points_m, center: LngLat): LngLat[]` — uses `turf.destination` with each point's bearing/distance from origin to produce real lng/lat coords around `center`.
- Center = current `map.getCenter()` at the moment "Generate" is clicked.

Result is passed into the existing `setOriginalRing(...)` + `setMode("locked")` flow, so persistence, area readout, overlay dragging, and search-to-overlay all keep working unchanged.

## Cloud / secrets

Requires Lovable Cloud enabled for `LOVABLE_API_KEY`. If not yet enabled, I'll enable it as part of the implementation and mention it to the user.

## Out of scope

- No changes to drawing, dragging, search, or persistence behavior.
- No new UI library; dialog is a lightweight inline overlay matching the existing bottom-sheet style.
