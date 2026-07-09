import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type GeneratedShape = {
  label: string;
  area_m2: number;
  points_m: Array<{ x: number; y: number }>;
};

const SYSTEM = `You estimate the real-world footprint (top-down plan view) of things a user describes and return it as a polygon.

Rules:
- Interpret quantities literally (e.g. "5 shipping containers" = five standard 20ft containers arranged in a reasonable compact layout).
- Use real approximate dimensions in METERS. A standard 20ft shipping container is ~6.06m long x 2.44m wide.
- Return a simple, non-self-intersecting polygon (8-40 points) whose centroid is at (0,0), with coordinates in meters. +x = east, +y = north.
- For rectangular/box objects, return the rectangle corners. For groups, return the outline of the whole group as arranged.
- For natural areas (parks, fields, lakes), approximate an outline of appropriate size.
- area_m2 must roughly match the polygon.
- Keep it small and reasonable — do not invent enormous areas.`;

export const generateShape = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ description: z.string().min(1).max(500) }).parse(data))
  .handler(async ({ data }): Promise<GeneratedShape> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Describe as polygon: ${data.description}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "shape",
            strict: true,
            schema: {
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
                    properties: {
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                    required: ["x", "y"],
                  },
                },
              },
              required: ["label", "area_m2", "points_m"],
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

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: GeneratedShape;
    try {
      parsed = JSON.parse(content) as GeneratedShape;
    } catch {
      throw new Error("Model returned invalid JSON");
    }

    if (!parsed.points_m || parsed.points_m.length < 3) {
      throw new Error("Model returned too few points");
    }
    // Clamp / sanitize
    parsed.points_m = parsed.points_m
      .slice(0, 80)
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (parsed.points_m.length < 3) throw new Error("Invalid polygon");

    return parsed;
  });
