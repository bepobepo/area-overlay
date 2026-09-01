# Rotate handle + AI disaster-area comparison

## 1. Rotate handle

Today a long press "grabs" a shape so it can be dragged. Add rotation to that same grabbed state.

- After the long press succeeds (shape becomes active), show a small circular handle just outside the shape, above its top edge, connected by a thin line to the shape's center.
- Dragging the handle rotates the shape around its own center; the shape stays in place and keeps its real-world size.
- Rotation works on whichever shape was grabbed (the drawn shape or the placed overlay), matching the current drag behavior.
- While rotating, map panning is disabled and the shape gets the same "active" styling used during drag.
- The handle disappears when the user taps elsewhere on the map, or on Reset.
- Snapping: rotation is free-form, with a light snap to 0/90/180/270 degrees when within a couple of degrees.

## 2. Compare real disaster areas from the news

New third action next to "Draw on map" / "Draw with AI": **Disaster areas**.

- Opens a sheet with a short prompt and quick filters (Wildfire, Flood, Hurricane, Landslide, Earthquake, Any).
- AI returns a list of recent weather/climate disaster events, each showing: event name, place, date, disaster type, and the affected area with its unit (e.g. "18,400 hectares burned", "flooded area ~120 km²"), plus a one-line summary.
- Tapping an event draws a polygon of that real affected area on the map — a rough outline sized to match the reported area — labeled with the event name.
- From there the existing flow applies: search another location and the outline moves there at true scale, and it can be dragged and rotated.
- Each item notes that the figure is a reported estimate, with the source name when the model provides one.

## Technical notes

- Rotation: reuse the existing long-press state in `src/components/ShapeSwapMap.tsx`. Store a rotation angle per shape and apply it with a geodesic rotate about the shape centroid (`@turf/turf` `transformRotate`), so real-world dimensions are preserved. The handle is a MapLibre symbol/circle layer plus a line layer, hit-tested with `queryRenderedFeatures` like the existing drag.
- News search: new server function `src/lib/disaster-news.functions.ts` calling the Lovable AI Gateway (`google/gemini-3-flash-preview`) with a JSON-schema response returning `events[]` (`title`, `place`, `country`, `date`, `type`, `area_value`, `area_unit`, `lat`, `lon`, `summary`, `source`). The model is asked for recent, well-reported events; results are validated and clamped server-side.
- Area to polygon: convert the reported area to m² and generate an outline of that area (rounded blob for fire/flood scars, using the existing meters-to-lng/lat helper), so the drawn shape matches the reported hectares/km² rather than tracing an exact burn perimeter.
- Also expose the news lookup as a third MCP tool (`search_disaster_areas`) so connected assistants can use it, then re-extract the MCP manifest.

## Caveats

- Event figures come from the model's knowledge of reporting, so the very latest events may be missing and numbers are approximate. Outlines represent the correct total area, not the exact real perimeter.
