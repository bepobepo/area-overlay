# Polygon Compare — Map Overlay App

A mobile-first web app for drawing a shape around one area (e.g. Victoria Park, London) and dropping that exact shape as an overlay on another location (e.g. an area of Tel Aviv) to compare size and footprint.

## Core user flow

1. Open app → full-screen map centered on user's location (or a default city).
2. Tap "Draw" → tap points on the map to build a polygon; tap "Finish" to close it.
3. See area stats (km² / acres) and a chip showing the polygon is "locked".
4. Tap the search bar → type an address / place name → autocomplete suggestions.
5. Pick a result → map flies to that location and the SAME polygon (preserving real-world size, in meters) is rendered centered on the new spot.
6. Drag the overlay to fine-tune position; optionally rotate. Toggle between "original" and "overlay" view, or show both side-by-side on one map.
7. Clear / redraw / share link with encoded polygon + target location.

## Screens (single route, mobile-first)

- `/` — Map screen with bottom sheet controls (Draw, Search, Compare, Clear, Stats).
- `/about` — Short explainer + credits.

## Key design commitments

- Full-bleed map, floating translucent controls, bottom sheet for actions (thumb-reachable).
- Distinct visual identity — not a generic Google-Maps clone. Dark map style, one strong accent color for the polygon, contrasting accent for the overlay.
- Clear affordances for the two polygons: original (solid outline, filled) vs. overlay (dashed outline, different hue).

## Technical approach

- **Map + drawing**: MapLibre GL JS (open source, mobile-friendly, works with free tile providers) + `@mapbox/mapbox-gl-draw` compatible fork or a lightweight custom tap-to-add-vertex drawer. Rationale: no API key needed for basic tiles (MapTiler/OpenFreeMap), avoids Google Maps Platform cost/setup for a first version.
- **Geocoding / address search**: MapTiler Geocoding or Nominatim (OpenStreetMap) via a TanStack server function to keep any key server-side. Debounced autocomplete.
- **Geometry math**: `@turf/turf` for area calculation, centroid, translating a polygon to a new center while preserving real-world dimensions (compute offset per-vertex in meters using destination bearings from the new centroid).
- **State**: local React state + URL search params (encoded polygon + target) so results are shareable. No backend/database needed for v1.
- **Persistence**: `localStorage` for the last-drawn polygon (read in `useEffect` to avoid SSR hydration issues).
- **Stack**: TanStack Start (existing), Tailwind v4, shadcn components for the bottom sheet, buttons, and command palette style search.

## Out of scope for v1

- Accounts, saving multiple polygons to a database.
- Rotating overlay by arbitrary angle (can add later; v1 supports drag-to-move only).
- 3D / satellite toggle.
- Native mobile app.

## Open decisions to confirm before build

1. **Map tiles provider**: MapMaker/MapTiler (needs a free API key from user) vs. OpenFreeMap (no key, less polished styles). Default recommendation: MapTiler for quality; I'll ask for the key when we get there.
2. **Geocoding provider**: MapTiler (same key) vs. Nominatim (no key, rate-limited, attribution required). Default: same as tiles provider.
3. **Comparison view**: overlay both polygons on one map at the new location (recommended, simpler on mobile) vs. split-screen two maps. Default: single map overlay.

I'll ask these as a follow-up question after you approve the overall direction, or you can answer now.
