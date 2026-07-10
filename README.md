# ShapeSwap

Draw or AI-select a shape on the map, then drop it onto any other place in the world to compare sizes at a glance.

## Features

- **Freehand drawing** — hold and drag to trace any region on the map.
- **AI-assisted shape selection** — describe a place and let AI outline it for you.
- **Location comparison** — search for any city or landmark and overlay your shape on top to compare scale.
- **Interactive overlay** — drag, reposition, and explore the projected shape anywhere on Earth.
- **First-time onboarding** — guided highlights help new users get started fast.

## Tech Stack

- [TanStack Start](https://tanstack.com/start) (React 19 + SSR)
- [Vite 7](https://vitejs.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Lovable Cloud](https://docs.lovable.dev/features/cloud) for server functions (AI shape generation, geocoding)
- Map rendering via MapLibre GL

## Getting Started

```bash
bun install
bun run dev
```

The app runs at `http://localhost:8080`.

## Project Structure

```
src/
├── routes/              # File-based TanStack routes
├── components/          # UI components (ShapeSwapMap, etc.)
├── lib/                 # Server functions (ai-shape, geocode)
└── styles.css           # Tailwind v4 theme + custom animations
```

## Development

This project is built and maintained with [Lovable](https://lovable.dev). Edits made in the Lovable editor sync automatically to this repository, and pushes to this repo sync back to Lovable.

## License

MIT
