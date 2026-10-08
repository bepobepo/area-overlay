import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { finalizeShape } from "../../ai-shape-finalize";
import { SHAPE_SCHEMA, SHAPE_SYSTEM, sanitizeShape, type GeneratedShape } from "../../ai-shape-schema";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  return (globalThis as RuntimeGlobals).process?.env?.[name];
}

export default defineTool({
  name: "generate_area_shape",
  title: "Generate area shape",
  description:
    "Estimate the real-world footprint of a described thing (e.g. '5 shipping containers', 'area hit by the Hiroshima bomb') and return it as a polygon in meters centered on (0,0), with reasoning, context, people affected and a source when applicable.",
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
          { role: "system", content: SHAPE_SYSTEM },
          { role: "user", content: `Describe as polygon: ${description}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "shape", strict: true, schema: SHAPE_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) throw new ToolError("Rate limit reached. Try again in a moment.");
      if (res.status === 402) throw new ToolError("AI credits exhausted for this app.");
      throw new ToolError(`AI request failed (${res.status})`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let raw: GeneratedShape;
    try {
      raw = JSON.parse(json.choices?.[0]?.message?.content ?? "") as GeneratedShape;
    } catch {
      throw new ToolError("The model returned an unreadable shape.");
    }
    const clean = sanitizeShape(raw);
    if (!clean) throw new ToolError("The model returned an invalid polygon.");
    const shape = await finalizeShape(clean, raw.kind ?? "estimate", raw.place_query ?? null);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(shape, null, 2) }],
      structuredContent: { shape },
    };
  },
});
