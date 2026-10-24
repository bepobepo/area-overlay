# Share as a picture, not a link

## What the user gets
Tapping **Share** opens a preview of a ready-made picture card. The buttons are **Share**, **Download** and **Close**.

The card (portrait, 1080x1350, fits Instagram/WhatsApp/X):

```text
+-----------------------------+
|  SHAPE SWAP                 |
|  Forest fires in Mali       |  <- shape name
|  7,001 ha  ~ 9,800 pitches  |  <- size + familiar comparison
+-----------------------------+
|                             |
|   map snapshot: the shape   |
|   placed over the compared  |
|   place, with its label     |
|                             |
+-----------------------------+
|  Compared with: London      |
|  [Disaster only]            |
|  Flood · 28 Aug 2026        |
|  Philippines                |
|  Short summary (2-3 lines)  |
|  People affected: 120,000   |
|  Source: GDACS / ReliefWeb  |
+-----------------------------+
|  area-compare.lovable.app   |
+-----------------------------+
```

- For AI shapes, the info section shows the short "What happened" text, people affected (if known) and the source name.
- For hand-drawn shapes, it shows only the size and the compared place.
- On phones, **Share** opens the usual share menu with the picture attached. Where sharing files isn't supported, it downloads the PNG instead.
- The current link-only share is removed. A short link stays as small text on the card only.

## Technical details
- Make the MapLibre map keep its drawing buffer so a snapshot can be taken. Before capturing, fit the view to the overlay shape and wait for the map to be `idle`.
- New `src/lib/share-card.ts`: `renderShareCard({ mapCanvas, label, areaText, comparison, place, info })` draws onto an offscreen 2D canvas with wrapped text and semantic theme colors. It returns a PNG Blob. MapTiler tiles are CORS-enabled, so the canvas stays exportable.
- New `ShareCardDialog` inside `ShapeSwapMap.tsx`: shows the image preview. **Share** uses `navigator.share({ files: [File] })` when `navigator.canShare` allows it, otherwise falls back to downloading the file.
- Remove the `#s=` text-share path from the Share button. Old shared links keep decoding so existing links don't break.
- Disaster info comes from `shapeInfo.event` (type, date, country, details, people_affected, source). AI info comes from `shapeInfo.shape`.
