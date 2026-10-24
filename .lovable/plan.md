# Add the how-to video to the welcome box and "?" button

## What changes
- The welcome box that opens the first time now shows the 30-second how-to video above the three steps.
- The video starts automatically with no sound, loops, and plays inline on phones (doesn't go full screen). It has controls so people can pause or replay it.
- The "?" button opens the same box with the video, so people can watch it again at any time.
- On small screens the box scrolls if needed, and the video is sized to fit (portrait video, capped height) so the "Got it" button stays reachable.

## Technical details
- Upload the video with `lovable-assets` to `src/assets/shapeswap-intro.mp4.asset.json`; import the pointer in `ShapeSwapMap.tsx`.
- In the existing welcome overlay (`welcomeOpen` block) add `<video src={asset.url} autoPlay muted loop playsInline controls preload="metadata">`, rounded, `max-h-[45vh]`, aspect 780/940.
- No change to the once-only welcome logic.
