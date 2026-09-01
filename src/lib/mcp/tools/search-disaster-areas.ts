import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  return (globalThis as RuntimeGlobals).process?.env?.[name];
}

function systemPrompt(today: string) {
  return `You are a research assistant that lists the MOST RECENT, well-reported weather and climate related disasters.

Today's date is ${today}.

Rules:
- Only include real, widely reported events.
- RECENCY IS THE TOP PRIORITY. Only include events from the last 12 months relative to today; go back further only if needed, never more than 2 years.
- Order the array strictly newest first.
- Give the date as YYYY-MM or YYYY-MM-DD.
- Each event MUST have a reported affected-area figure (burned area, flooded area, area of landslide/impact zone). Use the unit the reporting used.
- lat/lon must be the approximate center of the affected area.
- summary: one short sentence.
- details: 2-3 sentences on what happened and its impact.
- people_affected: best reported number of people affected (killed, displaced or evacuated). Use null if not reported.
- people_affected_note: what that number counts, e.g. "displaced". Use "" when people_affected is null.
- source: the outlet or agency that reported the area figure. Use "unknown" if unsure.
- Never invent figures. Skip events whose affected area you do not know.
- Return 6 to 10 events.`;
}

function dateSortKey(date: unknown): number {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(date ?? "").trim());
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2] ?? "01") * 100 + Number(m[3] ?? "01");
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          place: { type: "string" },
          country: { type: "string" },
          date: { type: "string" },
          type: { type: "string" },
          area_value: { type: "number" },
          area_unit: { type: "string", enum: ["hectares", "km2", "acres", "m2", "sq_mi"] },
          lat: { type: "number" },
          lon: { type: "number" },
          summary: { type: "string" },
          source: { type: "string" },
        },
        required: [
          "title",
          "place",
          "country",
          "date",
          "type",
          "area_value",
          "area_unit",
          "lat",
          "lon",
          "summary",
          "source",
        ],
      },
    },
  },
  required: ["events"],
} as const;

export default defineTool({
  name: "search_disaster_areas",
  title: "Search disaster areas",
  description:
    "List recent weather and climate disasters (wildfires, floods, hurricanes, landslides, earthquakes) with their reported affected area and approximate coordinates, so the areas can be compared.",
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
    const key = runtimeEnv("LOVABLE_API_KEY");
    if (!key) throw new ToolError("AI is not configured for this app.");

    const filter = type === "any" ? "any weather/climate disaster type" : type;
    const extra = query?.trim() ? ` Focus on: ${query.trim()}.` : "";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `List recent disasters (${filter}) with reported affected areas.${extra}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "disasters", strict: true, schema: SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) throw new ToolError("Rate limit reached. Try again in a moment.");
      if (res.status === 402) throw new ToolError("AI credits exhausted for this app.");
      throw new ToolError(`AI request failed (${res.status})`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let parsed: { events?: unknown[] };
    try {
      parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "");
    } catch {
      throw new ToolError("The model returned an unreadable result.");
    }

    const events = (parsed.events ?? []).slice(0, 12);
    if (events.length === 0) throw new ToolError("No events with reported areas were found.");

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ events }, null, 2) }],
      structuredContent: { events },
    };
  },
});
