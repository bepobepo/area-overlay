import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

export default defineTool({
  name: "search_place",
  title: "Search place",
  description:
    "Look up a place, address, park or neighbourhood by name and return matching locations with latitude/longitude.",
  inputSchema: {
    query: z.string().min(2).describe("Place name or address, e.g. 'Victoria Park, London'."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ query }) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query.trim());
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "ShapeSwap/1.0 (lovable.app)", "Accept-Language": "en" },
    });
    if (!res.ok) {
      return {
        content: [{ type: "text" as const, text: `Geocoding failed (${res.status})` }],
        isError: true,
      };
    }
    const json = (await res.json()) as NominatimResult[];
    const results = json.map((r) => ({
      id: String(r.place_id),
      label: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      structuredContent: { results },
    };
  },
});
