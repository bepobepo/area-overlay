import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "search_disaster_areas",
  title: "Search disaster areas",
  description:
    "List recent weather and climate disasters (wildfires, floods, hurricanes, landslides, earthquakes) with their reported affected area and approximate coordinates, so the areas can be compared. Results are cached for the day.",
  inputSchema: {
    type: z
      .enum(["any", "wildfire", "flood", "hurricane", "landslide", "earthquake"])
      .describe("Disaster type filter."),
    query: z
      .string()
      .max(200)
      .nullable()
      .describe("Optional extra focus, e.g. a region or year. Use null for none."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ type, query }) => {
    const { getDisasters } = await import("@/lib/disaster-news.server");

    try {
      const result = await getDisasters(type, query ?? undefined);
      if (result.events.length === 0)
        throw new ToolError("No events with reported areas were found.");
      const payload = {
        events: result.events,
        fetched_at: result.fetched_at,
        stale: result.stale,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError(err instanceof Error ? err.message : "Disaster lookup failed.");
    }
  },
});
