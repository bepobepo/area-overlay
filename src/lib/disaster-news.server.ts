// Server-only disaster news logic: AI lookup + persistent daily cache.
import {
  dateSortKey,
  eventAreaM2,
  type DisasterEvent,
  type DisasterFilter,
} from "./disaster-news.functions";

export const DISASTER_FILTERS: DisasterFilter[] = [
  "any",
  "wildfire",
  "flood",
  "hurricane",
  "landslide",
  "earthquake",
];

export type CachedDisasters = {
  events: DisasterEvent[];
  fetched_at: string;
  stale: boolean;
};

/** Current calendar day in New York, as YYYY-MM-DD. */
export function nyDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function normalizeQueryKey(query?: string | null): string {
  return (query ?? "").trim().toLowerCase().slice(0, 200);
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

const EVENT_SCHEMA = {
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
          "details",
          "people_affected",
          "people_affected_note",
        ],
      },
    },
  },
  required: ["events"],
} as const;

export class AiGatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Calls the AI gateway and returns validated, newest-first events. */
export async function fetchDisastersFromAI(
  type: DisasterFilter,
  query?: string,
): Promise<DisasterEvent[]> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const filter = type === "any" ? "any weather/climate disaster type" : type;
  const extra = query?.trim() ? ` Focus on: ${query.trim()}.` : "";
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
        json_schema: { name: "disasters", strict: true, schema: EVENT_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429)
      throw new AiGatewayError(429, "Rate limit reached. Try again in a moment.");
    if (res.status === 402)
      throw new AiGatewayError(402, "AI credits exhausted. Add credits in workspace settings.");
    if (res.status === 403)
      throw new AiGatewayError(403, "AI access is blocked for this workspace.");
    throw new AiGatewayError(res.status, `AI gateway error ${res.status}: ${text.slice(0, 200)}`);
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

  events.sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));
  if (events.length === 0)
    throw new Error("No events with reported areas were returned. Try again.");
  return events.slice(0, 12);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type CacheRow = {
  events: unknown;
  fetched_at: string;
  ny_day: string;
};

async function readCache(type: DisasterFilter, queryKey: string): Promise<CacheRow | null> {
  const db = await admin();
  const { data } = await db
    .from("disaster_searches")
    .select("events, fetched_at, ny_day")
    .eq("filter_type", type)
    .eq("query_key", queryKey)
    .maybeSingle();
  return (data as CacheRow | null) ?? null;
}

async function writeCache(type: DisasterFilter, queryKey: string, events: DisasterEvent[]) {
  const db = await admin();
  await db.from("disaster_searches").upsert(
    {
      filter_type: type,
      query_key: queryKey,
      events: events as unknown as never,
      fetched_at: new Date().toISOString(),
      ny_day: nyDay(),
    },
    { onConflict: "filter_type,query_key" },
  );
}

/**
 * Returns cached events when they were fetched on the current New York day,
 * otherwise runs a fresh search and stores it. Falls back to a stale row when
 * the AI call fails.
 */
export async function getDisasters(
  type: DisasterFilter,
  query?: string,
  force = false,
): Promise<CachedDisasters> {
  const queryKey = normalizeQueryKey(query);
  const cached = await readCache(type, queryKey);

  if (!force && cached && cached.ny_day === nyDay()) {
    return {
      events: cached.events as DisasterEvent[],
      fetched_at: cached.fetched_at,
      stale: false,
    };
  }

  try {
    const events = await fetchDisastersFromAI(type, query);
    await writeCache(type, queryKey, events);
    return { events, fetched_at: new Date().toISOString(), stale: false };
  } catch (err) {
    if (cached) {
      return {
        events: cached.events as DisasterEvent[],
        fetched_at: cached.fetched_at,
        stale: true,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------- job state

type JobState = {
  status: string;
  paused_reason: string | null;
  lease_until: string | null;
  last_ny_day: string | null;
};

const JOB = "disaster_refresh";

export async function readJobState(): Promise<JobState | null> {
  const db = await admin();
  const { data } = await db
    .from("job_state")
    .select("status, paused_reason, lease_until, last_ny_day")
    .eq("job", JOB)
    .maybeSingle();
  return (data as JobState | null) ?? null;
}

async function updateJobState(patch: Record<string, unknown>) {
  const db = await admin();
  await db
    .from("job_state")
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("job", JOB);
}

/** Refreshes the preset filters. Returns a summary of what happened. */
export async function refreshDisasterPresets(): Promise<{
  status: string;
  refreshed: string[];
  skipped: string[];
  reason?: string;
}> {
  const state = await readJobState();
  const today = nyDay();

  if (state?.status === "paused") {
    // Probe with a single filter to detect out-of-band recovery.
    try {
      const events = await fetchDisastersFromAI("any");
      await writeCache("any", "", events);
      await updateJobState({ status: "idle", paused_reason: null });
    } catch (err) {
      return {
        status: "paused",
        refreshed: [],
        skipped: DISASTER_FILTERS,
        reason: state.paused_reason ?? (err instanceof Error ? err.message : "paused"),
      };
    }
  }

  if (state?.last_ny_day === today && state?.status !== "paused") {
    return { status: "already_fresh", refreshed: [], skipped: DISASTER_FILTERS };
  }

  const now = Date.now();
  const leaseHeld = state?.lease_until ? Date.parse(state.lease_until) > now : false;
  if (leaseHeld) return { status: "locked", refreshed: [], skipped: DISASTER_FILTERS };

  await updateJobState({
    status: "running",
    lease_until: new Date(now + 10 * 60_000).toISOString(),
    last_run_at: new Date().toISOString(),
  });

  const refreshed: string[] = [];
  const skipped: string[] = [];
  let rateLimits = 0;

  try {
    for (const filter of DISASTER_FILTERS) {
      // Idempotent progress: skip filters already refreshed today.
      const cached = await readCache(filter, "");
      if (cached?.ny_day === today) {
        skipped.push(filter);
        continue;
      }
      try {
        const events = await fetchDisastersFromAI(filter);
        await writeCache(filter, "", events);
        refreshed.push(filter);
      } catch (err) {
        if (err instanceof AiGatewayError && (err.status === 402 || err.status === 403)) {
          await updateJobState({
            status: "paused",
            paused_reason: err.message,
            lease_until: null,
          });
          return { status: "paused", refreshed, skipped, reason: err.message };
        }
        if (err instanceof AiGatewayError && err.status === 429) {
          rateLimits += 1;
          if (rateLimits >= 2) {
            await updateJobState({ status: "idle", lease_until: null });
            return { status: "rate_limited", refreshed, skipped, reason: err.message };
          }
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        skipped.push(filter);
      }
    }

    await updateJobState({ status: "idle", lease_until: null, last_ny_day: today });
    return { status: "ok", refreshed, skipped };
  } catch (err) {
    await updateJobState({ status: "idle", lease_until: null });
    throw err;
  }
}
