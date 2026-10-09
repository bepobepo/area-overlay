# Use a simple shape at the correct size instead of AI-drawn outlines

## What changes

When the app can't use an official boundary for a place (as with Gaza, whose official outline includes sea), it will no longer stretch the AI's freehand outline. That outline is what produced the thin "sausage". Instead it draws a **simple rounded shape** whose total area is exactly right. The shape is close to round, at most about 1.5 times as long as it is wide, so it reads clearly as "this is the size".

- **Real places without a usable border** (Gaza, coastal regions, and similar): simple rounded shape, correct area.
- **Events and natural areas** (blast zones, fires, floods, forests): simple rounded shape, correct area.
- **Objects and buildings** (shipping containers, football pitch, a 747): unchanged. They keep the AI's precise rectangle or footprint, since those shapes are reliable and meaningful.
- **Real places with a good official border** (Central Park, etc.): unchanged. They still get the real outline.

The info card's outline line reads **"Outline: simplified shape for scale (X km²)"** in these cases, so it's clear the shape isn't the real border.

## Technical details

- Add `shape_type` to the AI schema: "object" (man-made/rectangular footprint) or "area" (place, event, natural region).
- In `finalizeShape`: OSM outline if accepted, as now. Otherwise, if `shape_type === "area"`, generate a 48-point ellipse in metres with a 1.3:1 aspect ratio, sized so its area equals `area_m2`, and set `outline_source: "generic"`. Objects keep the current scale-to-area path (`"ai"`).
- Update the `outline_source` type and the card label in `ShapeSwapMap.tsx`. The MCP tool picks this up automatically through the shared helper.
