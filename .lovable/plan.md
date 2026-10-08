# Drag-to-draw + point-by-point polygons

After tapping "Draw on map", users can use either method — no extra toggle:

- **Drag** (press and move): freehand trace, same as today.
- **Click/tap** (press and release without moving): drops a vertex. The preview shows the points, the line between them, and a dashed closing edge back to the first point.
- **Finish a point polygon** by any of:
  - Double-click / double-tap — adds the final point and closes the shape back to the first point.
  - Clicking the first point again (when at least 3 points).
  - Tapping "Ready".
- Once closed it behaves like a finished freehand trace: user can tap Ready to lock it, or start a new drag/click to redo.
- Hint text updates: "Drag to trace, or tap to place points. Double-tap to close."
- An "Undo point" button appears while placing points.

## Technical details (ShapeSwapMap.tsx)

- In the drawing press handler, classify the gesture on release: movement under ~6px and short duration = tap (append vertex to `drawingRef`), otherwise freehand (replace points as now).
- Track a `drawStyle` ref ("freehand" | "points") and a `closed` flag; a tap after a closed shape or after a freehand trace starts a new point polygon.
- Disable MapLibre `doubleClickZoom` while in drawing mode; restore on exit. Detect double-tap on touch manually (two taps < 300ms, < 20px apart). Dedupe the duplicate vertex the second click adds.
- Hit-test first vertex in screen space (~14px) to close.
- Preview: render open polyline + dashed closing segment layer while in points mode; existing fill when ≥3 points.
- Ready/reset/onboarding logic unchanged.
