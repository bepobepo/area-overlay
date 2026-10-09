export type GeneratedShape = {
  label: string;
  area_m2: number;
  points_m: Array<{ x: number; y: number }>;
  reasoning: string;
  context: string;
  people_affected: number | null;
  people_affected_note: string;
  source_name: string | null;
  source_url: string | null;
  outline_source?: "osm" | "ai" | "generic";
  shape_type?: string;
  kind?: string;
  place_query?: string | null;
};

export const SHAPE_SYSTEM = `You estimate the real-world footprint (top-down plan view) of things a user describes and return it as a polygon, plus a short explanation.

Rules:
- Interpret quantities literally (e.g. "5 shipping containers" = five standard 20ft containers arranged in a reasonable compact layout).
- Use real approximate dimensions in METERS. A standard 20ft shipping container is ~6.06m long x 2.44m wide.
- Return a simple, non-self-intersecting polygon (8-40 points) whose centroid is at (0,0), with coordinates in meters. +x = east, +y = north.
- For rectangular/box objects, return the rectangle corners. For groups, return the outline of the whole group as arranged.
- For natural areas, events or historical incidents (e.g. a bomb blast zone, a fire), approximate an outline of the documented affected area.
- area_m2 must roughly match the polygon.
- reasoning: 2-4 sentences explaining how the size was derived (dimensions, radius, formula, assumptions).
- context: 1-3 sentences of background for real events/places; empty string for generic objects.
- people_affected: number of people affected (killed/injured/displaced) only for real events; otherwise null. people_affected_note says what it counts (e.g. "killed by end of 1945"), empty string if null.
- source_name/source_url: a reputable source (e.g. Wikipedia, official agency). Only give a URL if it is a well-known stable page you are confident exists; otherwise null. Use null for both when not applicable.
- kind: "real_place" if the description names a specific real place with a mapped boundary (a country, territory, city, park, lake, island, district), otherwise "estimate". place_query: for real_place, a precise geocodable name (e.g. "Gaza Strip", "Central Park, New York"); otherwise null.
- shape_type: "object" for man-made objects/buildings/vehicles/fields with a known rectangular or fixed footprint; "area" for places, regions, events and natural areas.`;

export const SHAPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    area_m2: { type: "number" },
    points_m: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    },
    reasoning: { type: "string" },
    context: { type: "string" },
    people_affected: { type: ["number", "null"] },
    people_affected_note: { type: "string" },
    source_name: { type: ["string", "null"] },
    source_url: { type: ["string", "null"] },
    kind: { type: "string", enum: ["real_place", "estimate"] },
    place_query: { type: ["string", "null"] },
    shape_type: { type: "string", enum: ["object", "area"] },
  },
  required: [
    "label",
    "area_m2",
    "points_m",
    "reasoning",
    "context",
    "people_affected",
    "people_affected_note",
    "source_name",
    "source_url",
    "kind",
    "place_query",
    "shape_type",
  ],
} as const;

/** Returns null if invalid. */
export function sanitizeShape(raw: GeneratedShape): GeneratedShape | null {
  const points = (raw.points_m ?? [])
    .slice(0, 80)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 3) return null;
  let url: string | null = null;
  if (typeof raw.source_url === "string") {
    try {
      const u = new URL(raw.source_url);
      if (u.protocol === "http:" || u.protocol === "https:") url = u.toString();
    } catch {}
  }
  const people =
    typeof raw.people_affected === "number" && Number.isFinite(raw.people_affected) && raw.people_affected > 0
      ? Math.round(raw.people_affected)
      : null;
  return {
    label: String(raw.label ?? ""),
    area_m2: Number(raw.area_m2) || 0,
    points_m: points,
    reasoning: String(raw.reasoning ?? ""),
    context: String(raw.context ?? ""),
    people_affected: people,
    people_affected_note: people ? String(raw.people_affected_note ?? "") : "",
    source_name: raw.source_name ? String(raw.source_name) : null,
    source_url: url,
  };
}
