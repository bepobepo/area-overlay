import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type GeocodeResult = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

export const searchPlaces = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ q: z.string() }).parse(data))
  .handler(async ({ data }): Promise<GeocodeResult[]> => {
    const q = data.q.trim();
    if (q.length < 2) return [];
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "0");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "ShapeSwap/1.0 (lovable.app)",
        "Accept-Language": "en",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
    }>;
    return json.map((r) => ({
      id: String(r.place_id),
      label: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));
  });
