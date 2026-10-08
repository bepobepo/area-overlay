# Explain the AI's size before drawing

When a user submits "Draw with AI", the shape no longer lands on the map straight away. First, an info card opens in the same dialog. It explains how the AI got to that size.

## What the card shows
- **Title**: what the shape is, e.g. "Hiroshima atomic bomb – severe damage zone".
- **Area**: the size (m², hectares or km²) plus a familiar comparison, e.g. "about 1,800 football pitches".
- **How the size was worked out**: 2–4 sentences, e.g. "Radius of near-total destruction ≈ 1.6 km → π·r² ≈ 13 km²."
- **What happened / context**: a short background note, shown for real events and places.
- **People affected**: a number plus what it counts (e.g. "~140,000 killed by end of 1945"). This row only appears when it applies. It is hidden for things like "5 shipping containers".
- **Source**: the source name, with a link if the AI is confident about it (e.g. Wikipedia, an official body). There is also a small note that figures are AI estimates and may be inaccurate.
- **Buttons**: "Draw on map" (places the shape like today) and "Back" (returns to the prompt so the user can edit and retry).

The AI agent tools (MCP) return the same extra fields.

## Technical details
- `src/lib/ai-shape.functions.ts`: extend the strict JSON schema with `reasoning`, `context`, `people_affected` (number|null), `people_affected_note`, `source_name`, `source_url` (string|null). Update the prompt to say that `people_affected` and the source fields must be null when unknown or not applicable, and that a source URL is only allowed if it is a well-known stable page. Sanitize the URL so only http(s) is accepted. Keep the current model and gateway call.
- Apply the same changes to `src/lib/mcp/tools/generate-area-shape.ts` and regenerate the MCP manifest.
- `ShapeSwapMap.tsx`: keep the AI result in a `pendingShape` state instead of applying it at once. The AI dialog renders a review view while `pendingShape` is set. "Draw on map" runs the existing apply logic and closes the dialog; "Back" clears `pendingShape`. The comparison is computed client-side from `area_m2` (football pitch ≈ 7,140 m²; city blocks or km² for large areas).
