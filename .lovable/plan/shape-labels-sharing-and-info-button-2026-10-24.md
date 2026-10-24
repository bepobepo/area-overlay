# Shape labels, sharing, and info button

## 1. Name written on the shape
- The shape's name (e.g. "Forest fires in Mauritania, Mali") appears in the middle of both the original shape and the compared copy.
- The text is semi-transparent with a soft outline, so the map underneath stays readable. It moves and rotates with the shape and gets smaller or hides when the shape is too small on screen.
- For hand-drawn shapes with no name, it shows the size (e.g. "2.3 km²").

## 2. Share this comparison
- A "Share" button appears in the bottom panel once a shape has been placed somewhere else.
- It creates a link that opens the app with the same shape, its name, its original place, the place it's compared to, its rotation, and the map view.
- The shared message spells it out, for example: "Forest fires in Mauritania, Mali (7,001 ha) compared to London — see it on Shape Swap".
- On phones it opens the normal share sheet. On computers it copies the link and shows "Link copied".
- Anyone opening the link sees a small banner: "Shared comparison: [shape] in [place]".

## 3. "i" button on the shape name
- The name tag at the top gets a small "i" button.
- For disaster shapes it reopens the event details (description, area, date, source link).
- For AI shapes it reopens the AI explanation card (how the size was worked out, people affected, source), without re-drawing the shape.
- Hand-drawn shapes have no "i".

## Technical details
- All in `ShapeSwapMap.tsx`. Labels: GeoJSON point sources at the centroid of `original`/`overlay`, symbol layers with `text-opacity` ~0.75 and a halo, plus a `text-rotate` that follows the shape's rotation.
- Store the label's source: `shapeInfo: { kind: "disaster", event } | { kind: "ai", shape } | null`, set where `shapeLabel` is set now. The "i" reopens `detailEvent` (disaster modal) or a read-only version of the pending-shape card.
- Share: put the ring (rounded coordinates, base64url), label, overlay center, rotation, place name, and map view into the URL `#s=` value. Decode it on load to set things back up. Use `navigator.share`, falling back to the clipboard plus a toast.
