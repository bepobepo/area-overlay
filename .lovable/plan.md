## Fixes to the onboarding guide

**1. Clearer wording on step 2**
- Change the search-bar tip from "Now let's compare the selected area to another on the map." to **"Now search for a place on the map to compare it to."**

**2. "Got it" on step 1 must not skip step 2**
- Current bug: both tips share a single `onboardingStep` state, and "Got it" on the buttons tip jumps straight to `"done"`, so the search-bar tip never shows.
- Fix: track dismissal per step. Replace the single `onboardingStep` with two independent flags persisted in localStorage:
  - `shapeswap.onboarding.buttonsDismissed`
  - `shapeswap.onboarding.searchDismissed`
- Show the buttons tip when `!buttonsDismissed && mode === "idle"`.
- Show the search tip when `!searchDismissed && mode === "locked" && !overlayCenter`.
- "Got it" on each tip only sets its own flag. Picking a search result also auto-dismisses the search tip.

**3. Brighter, actually blinking frame (not the whole card fading)**
- Remove `animate-pulse` from the card/search containers (it fades the whole element's opacity — that's what looked "slow and unclear").
- Add a dedicated blinking outline ring rendered as an absolutely-positioned sibling `<span>` inside each highlighted container, so only the frame animates and the content stays fully opaque.
- Define a new keyframe in `src/styles.css`:
  ```css
  @keyframes highlight-blink {
    0%, 100% { box-shadow: 0 0 0 2px hsl(var(--ring-color)), 0 0 16px 4px hsl(var(--ring-color) / 0.6); opacity: 1; }
    50%      { box-shadow: 0 0 0 3px hsl(var(--ring-color)), 0 0 28px 8px hsl(var(--ring-color) / 0.9); opacity: 1; }
  }
  .animate-highlight-blink { animation: highlight-blink 1s ease-in-out infinite; }
  ```
- Apply it to:
  - The bottom-sheet buttons container — bright fuchsia frame while step 1 is active.
  - The top search-bar container — bright cyan frame while step 2 is active.
- The frame overlay uses `pointer-events-none` and `rounded-2xl` matching the container so clicks still work and the ring hugs the corners.

**4. Files touched**
- `src/components/ShapeSwapMap.tsx` — state split, tip text, frame overlay markup.
- `src/styles.css` — new `highlight-blink` keyframe + utility class.

No changes to drawing, AI, search, or persistence logic.
