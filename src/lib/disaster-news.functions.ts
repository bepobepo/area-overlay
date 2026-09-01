import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type DisasterEvent = {
  title: string;
  place: string;
  country: string;
  date: string;
  type: string;
  area_value: number;
  area_unit: "hectares" | "km2" | "acres" | "m2" | "sq_mi";
  lat: number;
  lon: number;
  summary: string;
  source: string;
  details: string;
  people_affected: number | null;
  people_affected_note: string;
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

function systemPrompt(today: string) {
  return `You are a research assistant that lists the MOST RECENT, well-reported weather and climate related disasters.

Today's date is ${today}.

Rules:
- Only include real, widely reported events.
- RECENCY IS THE TOP PRIORITY. Only include events from the last 12 months relative to today. Only if you cannot find enough such events may you go back further, and never more than 2 years back.
- Order the array strictly newest first.
- Give the date as YYYY-MM or YYYY-MM-DD.
- Each event MUST have a reported affected-area figure (burned area, flooded area, area of landslide/impact zone). Use the unit the reporting used.
- lat/lon must be the approximate center of the affected area.
- summary: one short sentence.
- details: 2-3 sentences on what happened and its impact.
- people_affected: best reported number of people affected (killed, displaced or evacuated). Use null if not reported.
- people_affected_note: what that number counts, e.g. "displaced", "evacuated", "killed". Use "" when people_affected is null.
- source: the outlet or agency that reported the area figure (e.g. "Reuters", "Copernicus EMS"). Use "unknown" if unsure.
- Never invent figures. Skip events whose affected area you do not know.
- Return 6 to 10 events.`;
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
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<DisasterEvent[]> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const filter = data.type === "any" ? "any weather/climate disaster type" : data.type;
    const extra = data.query?.trim() ? ` Focus on: ${data.query.trim()}.` : "";
    const today = new Date().toISOString().slice(0, 10);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt(today) },
          {
            role: "user",
            content: `List the most recent disasters (${filter}) with reported affected areas, newest first. Today is ${today}; strongly prefer events from the last 12 months.${extra}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "disasters",
            strict: true,
            schema: {
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
                      area_unit: {
                        type: "string",
                        enum: ["hectares", "km2", "acres", "m2", "sq_mi"],
                      },
                      lat: { type: "number" },
                      lon: { type: "number" },
                      summary: { type: "string" },
                      source: { type: "string" },
                      details: { type: "string" },
                      people_affected: { type: ["number", "null"] },
                      people_affected_note: { type: "string" },
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
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Rate limit reached. Try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let parsed: { events?: DisasterEvent[] };
    try {
      parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "");
    } catch {
      throw new Error("Model returned invalid JSON");
    }

    const events = (parsed.events ?? []).filter(
      (e) =>
        Number.isFinite(e.area_value) &&
        e.area_value > 0 &&
        Number.isFinite(e.lat) &&
        Number.isFinite(e.lon) &&
        Math.abs(e.lat) <= 90 &&
        Math.abs(e.lon) <= 180 &&
        eventAreaM2(e) < 2_000_000_000_000,
    );

    if (events.length === 0) throw new Error("No events with reported areas were returned. Try again.");
    return events.slice(0, 12);
  });
