import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  return (globalThis as RuntimeGlobals).process?.env?.[name];
}

const SYSTEM = `You estimate the real-world footprint (top-down plan view) of things a user describes and return it as a polygon.

Rules:
- Interpret quantities literally (e.g. "5 shipping containers" = five standard 20ft containers arranged in a reasonable compact layout).
- Use real approximate dimensions in METERS. A standard 20ft shipping container is ~6.06m long x 2.44m wide.
- Return a simple, non-self-intersecting polygon (8-40 points) whose centroid is at (0,0), with coordinates in meters. +x = east, +y = north.
- For rectangular/box objects, return the rectangle corners. For groups, return the outline of the whole group as arranged.
- For natural areas (parks, fields, lakes), approximate an outline of appropriate size.
- area_m2 must roughly match the polygon.
- Keep it small and reasonable — do not invent enormous areas.`;

type GeneratedShape = {
  label: string;
  area_m2: number;
  points_m: Array<{ x: number; y: number }>;
};

export default defineTool({
  name: "generate_area_shape",
  title: "Generate area shape",
  description:
    "Estimate the real-world footprint of a described thing (e.g. '5 shipping containers', 'a football pitch') and return it as a polygon in meters, centered on (0,0).",
  inputSchema: {
    description: z
      .string()
      .min(1)
      .max(500)
      .describe("What to size up, e.g. '5 shipping containers' or 'an olympic swimming pool'."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  handler: async ({ description }) => {
    const key = runtimeEnv("LOVABLE_API_KEY");
    if (!key) throw new ToolError("AI is not configured for this app.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Describe as polygon: ${description}` },
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
                    properties: { x: { type: "number" }, y: { type: "number" } },
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
      if (res.status === 429) throw new ToolError("Rate limit reached. Try again in a moment.");
      if (res.status === 402) throw new ToolError("AI credits exhausted for this app.");
      throw new ToolError(`AI request failed (${res.status})`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let shape: GeneratedShape;
    try {
      shape = JSON.parse(json.choices?.[0]?.message?.content ?? "") as GeneratedShape;
    } catch {
      throw new ToolError("The model returned an unreadable shape.");
    }

    shape.points_m = (shape.points_m ?? [])
      .slice(0, 80)
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (shape.points_m.length < 3) throw new ToolError("The model returned an invalid polygon.");

    return {
      content: [{ type: "text" as const, text: JSON.stringify(shape, null, 2) }],
      structuredContent: { shape },
    };
  },
});
