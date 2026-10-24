# Welcome box, my location, and a clear next step after Ready

## 1. Welcome box on opening
- A small centered card the first time someone opens the app: "Shape Swap — Draw around any place (a park, a neighbourhood), then search another city to see how big it really is there."
- Three tiny steps with icons: Draw (or ask AI) -> Search a place -> Compare.
- One button "Got it". Shown once (remembered on the device); the existing button highlights appear after it closes.
- A small "?" button in the corner reopens it anytime.

## 2. Go to my current location
- A round location button on the map (top-right, below the zoom controls).
- Tapping it asks the browser for location, flies the map there and shows a blue dot.
- If permission is denied or unavailable, a short message explains it.
- In the search results, a "Use my location" option so users can drop their shape on where they are.

## 3. Clear next step after Ready
- Today the search hint only ever shows once. Instead, every time Ready is pressed (or an AI shape is placed) and no comparison exists yet:
  - The search bar gets the highlighted glow and auto-focus.
  - A short banner: "Shape saved (X km²). Now search a place to compare it with." with an arrow toward the search bar.
- It disappears as soon as a place is chosen, and reappears after Reset + new shape.

## Technical details
- All in `ShapeSwapMap.tsx`: new `WelcomeOverlay` with key `shapeswap.welcome.v1`; buttons tip gated on welcome closed.
- MapLibre `GeolocateControl` (trackUserLocation off, showUserLocation on) or a custom button calling `navigator.geolocation` + `flyTo`; "Use my location" in search sets overlay center to coords.
- Replace the one-time `searchTipDismissed` gating with state derived from `mode === "locked" && !overlayCenter`; keep the dismiss "x" for the current shape only.
