import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type DisasterEvent = {
  title: string;
  place: string;
  country: string;
  date: string;
  type: string;
  /** Null when no affected-area figure was reported. */
  area_value: number | null;
  area_unit: "hectares" | "km2" | "acres" | "m2" | "sq_mi";
  lat: number;
  lon: number;
  summary: string;
  source: string;
  /** Link to the original report. */
  url: string;
  details: string;
  people_affected: number | null;
  people_affected_note: string;
};

export type DisasterFilter =
  | "any"
  | "wildfire"
  | "flood"
  | "hurricane"
  | "landslide"
  | "earthquake";

export type DisasterSearchResult = {
  events: DisasterEvent[];
  fetched_at: string;
  /** True when the AI lookup failed and a previously cached list was returned. */
  stale: boolean;
};

export const AREA_UNIT_TO_M2: Record<DisasterEvent["area_unit"], number> = {
  hectares: 10_000,
  km2: 1_000_000,
  acres: 4046.86,
  m2: 1,
  sq_mi: 2_589_988,
};

export function eventAreaM2(e: Pick<DisasterEvent, "area_value" | "area_unit">): number {
  return e.area_value * (AREA_UNIT_TO_M2[e.area_unit] ?? 1);
}

/** Sortable key from a YYYY / YYYY-MM / YYYY-MM-DD date string. */
export function dateSortKey(date: string): number {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date?.trim() ?? "");
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2] ?? "01") * 100 + Number(m[3] ?? "01");
}

export const searchDisasters = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        type: z
          .enum(["any", "wildfire", "flood", "hurricane", "landslide", "earthquake"])
          .default("any"),
        query: z.string().max(200).optional(),
        force: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<DisasterSearchResult> => {
    const { getDisasters } = await import("./disaster-news.server");
    return getDisasters(data.type, data.query, data.force ?? false);
  });
