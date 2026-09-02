# Rotate handle: follows the shape, shorter, with an icon

## What changes

1. **Moves with the shape.** The handle currently sits at a distance based on the shape's real-world size, so on large shapes it ends up far away (in the screenshot, out at sea) and it only re-renders when polygon state changes. It becomes a screen-anchored control: it is placed just above the shape's top edge in pixels and re-positioned on every map render, drag, rotate, pan and zoom, so it always stays glued to the shape.

2. **Shorter.** Fixed short leader line (~26px) from the top edge of the shape to the handle, instead of a distance proportional to the shape's radius. The handle stays the same visual size at any zoom level.

3. **Clear rotation icon.** The plain black dot becomes a small round white button with a dark circular-arrow (rotate) glyph, sized for touch, with a subtle shadow so it reads as a control rather than a map dot.

## Behaviour kept as-is

- Appears only after the long-press grab, on whichever shape was grabbed.
- Dragging it rotates the shape around its centre at true real-world size, with the light snap to 0/90/180/270.
- Disappears when tapping the map elsewhere, and on Reset.

## Technical notes

In `src/components/ShapeSwapMap.tsx`:

- Replace the `handle` GeoJSON source with a DOM overlay: an absolutely positioned element inside the map container holding the leader line and a `RotateCw` (lucide) button, styled with existing semantic tokens.
- Compute its position from the active ring projected to pixels via `map.project()`: take the top-most point of the projected ring, place the handle `26px` above it, horizontally at the projected centroid. Recompute in a `map.on("render")` handler (covers move/zoom/drag/rotate) using refs, so no React re-render per frame.
- Hit-testing: replace the `queryRenderedFeatures(["handle-point"])` branch in `handlePressStart` with a pointer/touch handler on the handle element itself that starts the same rotation flow (`rotatingRef`, `rotateStartRef`, disable `dragPan`), and keep the existing `handlePressMove` rotation math unchanged (bearing from centroid to pointer).
- Remove `handlePosition`, the `handle` source/layers, its entry in the `clearAll` source list, and the handle-geometry effect.
- Update the hint copy to mention the rotate button.
