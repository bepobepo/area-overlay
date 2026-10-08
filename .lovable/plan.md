# Make AI shapes the right size (and real places the real shape)

## Why Gaza came out about twice as big

The map is placing the shape correctly. The conversion from the AI's metres to map positions is accurate. The problem is the AI itself:

- The AI makes up the corner points of the outline from memory, in metres. It also states a separate "area" figure, but nothing checks that the two agree. Language models are bad at drawing coordinates, so the outline can easily be 2x too wide even when the stated area is about right (Gaza is ~365 km²).
- For a real place like Gaza, the AI only draws a rough blob. It never uses the real border.

## Fixes

1. **Real places use their real outline.** When the description is a real named place (Gaza Strip, Central Park, Manhattan…), the app looks up that place's official boundary from OpenStreetMap, which the address search already uses. It then draws that boundary, so the shape and size are exact. The AI still writes the explanation card (context, people affected, source).
2. **Everything else is checked against the stated size.** For objects, events and estimates (shipping containers, a blast zone…), the app measures the AI's outline. If the measured area doesn't match the area the AI gave, the app scales the outline to fit.
3. **The info card shows where the shape came from.** It reads either "Outline: official boundary (OpenStreetMap)" or "Outline: AI estimate, scaled to X km²". It shows the measured area, so the number on the card always matches what's on the map.

## Technical details

- AI schema: add `kind` ("real_place" | "estimate") and `place_query` (a geocodable name, or null).
- In `generateShape`: if `kind === "real_place"`, call Nominatim with `polygon_geojson=1`. Accept the result only for Polygon/MultiPolygon (largest ring, simplified to ≤400 points with Turf). Convert it to metres relative to the centroid so it moves like any other shape. Return `outline_source: "osm"` and `area_m2` from `turf.area`. If the lookup fails, use the estimate path.
- Estimate path: compute the polygon area with the shoelace formula in metres. If it differs from `area_m2` by more than 10%, scale the points by √(target/actual). Return `outline_source: "ai"`.
- MCP `generate_area_shape` uses the same shared helper; regenerate the manifest.
- The card in `ShapeSwapMap.tsx` shows the outline source line. Point limits go up for OSM shapes (`sanitizeShape` currently caps at 80).
