import * as turf from "@turf/turf";
import type { GeneratedShape } from "./ai-shape-schema";

type Pt = { x: number; y: number };

function shoelace(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Look up the real boundary of a named place on OpenStreetMap; returns ring in meters around its centroid. */
async function fetchOsmOutline(query: string, expectedArea: number): Promise<{ points: Pt[]; area: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("polygon_geojson", "1");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "ShapeSwap/1.0 (lovable.app)", "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ geojson?: GeoJSON.Geometry }>;
    for (const r of json) {
      const g = r.geojson;
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      // largest outer ring
      let best: GeoJSON.Position[] | null = null;
      let bestArea = 0;
      for (const p of polys) {
        const a = turf.area(turf.polygon([p[0]]));
        if (a > bestArea) {
          bestArea = a;
          best = p[0];
        }
      }
      if (!best || bestArea <= 0) continue;
      // Admin boundaries often include territorial waters; reject outlines far off the documented land area.
      if (expectedArea > 0) {
        const ratio = bestArea / expectedArea;
        if (ratio < 0.6 || ratio > 1.6) continue;
      }
      let poly = turf.polygon([best]);
      let tol = 0.0001;
      while (poly.geometry.coordinates[0].length > 400 && tol < 1) {
        poly = turf.simplify(turf.polygon([best]), { tolerance: tol, highQuality: true });
        tol *= 2;
      }
      const ring = poly.geometry.coordinates[0].slice(0, -1);
      const c = turf.centroid(poly).geometry.coordinates;
      const points = ring.map((p) => {
        const d = turf.distance(c, p, { units: "meters" });
        const b = (turf.bearing(c, p) * Math.PI) / 180;
        return { x: d * Math.sin(b), y: d * Math.cos(b) };
      });
      if (points.length < 3) continue;
      return { points, area: turf.area(poly) };
    }
  } catch {}
  return null;
}

/** Make the outline trustworthy: real boundary for real places, else scale AI outline to the stated area. */
export async function finalizeShape(
  shape: GeneratedShape,
  kind: string,
  placeQuery: string | null,
): Promise<GeneratedShape> {
  if (kind === "real_place" && placeQuery) {
    const osm = await fetchOsmOutline(placeQuery, shape.area_m2);
    if (osm) return { ...shape, points_m: osm.points, area_m2: osm.area, outline_source: "osm" };
  }
  const actual = shoelace(shape.points_m);
  let points = shape.points_m;
  if (actual > 0 && shape.area_m2 > 0 && Math.abs(actual - shape.area_m2) / shape.area_m2 > 0.1) {
    const k = Math.sqrt(shape.area_m2 / actual);
    points = points.map((p) => ({ x: p.x * k, y: p.y * k }));
  }
  return { ...shape, points_m: points, area_m2: shoelace(points), outline_source: "ai" };
}
