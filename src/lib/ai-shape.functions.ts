import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { finalizeShape } from "./ai-shape-finalize";
import { SHAPE_SCHEMA, SHAPE_SYSTEM, sanitizeShape, type GeneratedShape } from "./ai-shape-schema";

export type { GeneratedShape };

export const generateShape = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ description: z.string().min(1).max(500) }).parse(data))
  .handler(async ({ data }): Promise<GeneratedShape> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SHAPE_SYSTEM },
          { role: "user", content: `Describe as polygon: ${data.description}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "shape", strict: true, schema: SHAPE_SCHEMA },
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
    let parsed: GeneratedShape;
    try {
      parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "") as GeneratedShape;
    } catch {
      throw new Error("Model returned invalid JSON");
    }
    const shape = sanitizeShape(parsed);
    if (!shape) throw new Error("Invalid polygon");
    return finalizeShape(shape, parsed.kind ?? "estimate", parsed.place_query ?? null, parsed.shape_type);
  });
