// Server-only disaster logic: real reports from ReliefWeb + GDACS, AI used only
// to extract figures from the reported text. Persistent daily cache on top.
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

export class AiGatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------- classification

export function classify(text: string, glide?: string): DisasterFilter | "other" {
  const g = (glide ?? "").toUpperCase();
  if (/^(FL|FF)-/.test(g)) return "flood";
  if (/^(TC|ST)-/.test(g)) return "hurricane";
  if (/^WF-/.test(g)) return "wildfire";
  if (/^EQ-/.test(g)) return "earthquake";
  if (/^(LS|MS|AV)-/.test(g)) return "landslide";

  const t = text.toLowerCase();
  if (/wild ?fire|forest fire|bush ?fire|fires\b/.test(t)) return "wildfire";
  if (/flood|inundat/.test(t)) return "flood";
  if (/hurricane|cyclone|typhoon|tropical storm|severe storm/.test(t)) return "hurricane";
  if (/landslide|mudslide|mud slide|avalanche|debris flow/.test(t)) return "landslide";
  if (/earthquake|quake|seismic/.test(t)) return "earthquake";
  return "other";
}

// ------------------------------------------------------------------ ReliefWeb

type RawItem = {
  title: string;
  url: string;
  glide: string;
  date: string;
  text: string;
  kind: DisasterFilter | "other";
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(decodeEntities(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Recent tracked disasters from ReliefWeb's public feed (no API key needed). */
export async function fetchReliefWeb(): Promise<RawItem[]> {
  const res = await fetch("https://reliefweb.int/disasters/rss.xml", {
    headers: { "User-Agent": "area-compare (lovable app)" },
  });
  if (!res.ok) throw new Error(`ReliefWeb feed error ${res.status}`);
  const xml = await res.text();

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: RawItem[] = [];
  for (const item of items) {
    const title = stripTags(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? "");
    const url = stripTags(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1] ?? "");
    const pub = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(item)?.[1] ?? "";
    const desc = stripTags(/<description>([\s\S]*?)<\/description>/.exec(item)?.[1] ?? "");
    const glide =
      /(?:^|[^A-Z])((?:FL|FF|TC|ST|WF|EQ|LS|MS|AV|DR|VO|EP|TS|CE|OT)-\d{4}-\d{6}-[A-Z]{3})/.exec(
        desc + " " + item,
      )?.[1] ?? "";
    if (!title || !url) continue;
    const parsed = pub ? new Date(pub) : null;
    out.push({
      title,
      url,
      glide,
      date:
        parsed && !Number.isNaN(parsed.getTime())
          ? parsed.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      text: desc.slice(0, 3500),
      kind: classify(`${title} ${desc.slice(0, 400)}`, glide),
    });
  }
  return out;
}

// ----------------------------------------------------------------------- GDACS

type GdacsFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    eventtype?: string;
    name?: string;
    country?: string;
    fromdate?: string;
    url?: { report?: string };
    severitydata?: { severity?: number; severityunit?: string; severitytext?: string };
  };
};

/**
 * Wildfires from GDACS: these come with a real burnt-area figure in hectares
 * and coordinates, so no AI is involved.
 */
export async function fetchGdacsWildfires(): Promise<DisasterEvent[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 86_400_000);
  const url =
    `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=` +
    `${from.toISOString().slice(0, 10)}&toDate=${to.toISOString().slice(0, 10)}` +
    `&eventlist=WF&alertlevel=Green;Orange;Red`;
  const res = await fetch(url, { headers: { "User-Agent": "area-compare (lovable app)" } });
  if (!res.ok) throw new Error(`GDACS error ${res.status}`);
  const json = (await res.json()) as { features?: GdacsFeature[] };

  const events: DisasterEvent[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties;
    if (!p || p.eventtype !== "WF") continue;
    const coords = f.geometry?.coordinates;
    const ha = p.severitydata?.severity;
    if (!coords || !Number.isFinite(ha) || !ha || ha < 100) continue;
    const date = (p.fromdate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    events.push({
      title: p.name ?? "Wildfire",
      place: p.country ?? "",
      country: p.country ?? "",
      date,
      type: "wildfire",
      area_value: Math.round(ha),
      area_unit: "hectares",
      lat: coords[1],
      lon: coords[0],
      summary: p.severitydata?.severitytext ?? `${Math.round(ha).toLocaleString()} ha burnt`,
      source: "GDACS / Copernicus EFFIS",
      url: p.url?.report ?? "https://www.gdacs.org",
      details:
        `Satellite-detected burnt area of about ${Math.round(ha).toLocaleString()} hectares ` +
        `in ${p.country ?? "the affected area"}, recorded from ${date} by the Global Disaster ` +
        `Alert and Coordination System.`,
      people_affected: null,
      people_affected_note: "",
    });
  }
  events.sort((a, b) => (b.area_value ?? 0) - (a.area_value ?? 0));
  return events.slice(0, 12);
}

// -------------------------------------------------------------- AI extraction

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number" },
          place: { type: "string" },
          country: { type: "string" },
          lat: { type: "number" },
          lon: { type: "number" },
          area_value: { type: ["number", "null"] },
          area_unit: { type: "string", enum: ["hectares", "km2", "acres", "m2", "sq_mi"] },
          people_affected: { type: ["number", "null"] },
          people_affected_note: { type: "string" },
          summary: { type: "string" },
          details: { type: "string" },
          source: { type: "string" },
        },
        required: [
          "index",
          "place",
          "country",
          "lat",
          "lon",
          "area_value",
          "area_unit",
          "people_affected",
          "people_affected_note",
          "summary",
          "details",
          "source",
        ],
      },
    },
  },
  required: ["events"],
} as const;

type Extracted = {
  index: number;
  place: string;
  country: string;
  lat: number;
  lon: number;
  area_value: number | null;
  area_unit: DisasterEvent["area_unit"];
  people_affected: number | null;
  people_affected_note: string;
  summary: string;
  details: string;
  source: string;
};

/** Pulls figures out of the reported text. Never invents numbers. */
async function extractFromReports(items: RawItem[]): Promise<Extracted[]> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const payload = items.map((it, i) => ({
    index: i,
    title: it.title,
    glide: it.glide,
    date: it.date,
    report: it.text,
  }));

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You extract facts from official disaster situation reports. You NEVER invent or estimate figures.

For each numbered report return one object:
- place: the affected region named in the report (e.g. "Luzon and Metro Manila").
- country: the affected country.
- lat/lon: approximate geographic centre of the affected region. This is the only value you may infer from geography.
- area_value + area_unit: the affected/flooded/burnt/damaged AREA figure stated in the report text. If the report states no area figure, area_value MUST be null (still give any unit, it is ignored).
- people_affected: the number of people affected/displaced/killed stated in the report, else null. Prefer the largest "affected" figure.
- people_affected_note: what that number counts, e.g. "affected", "displaced", "killed". "" when null.
- summary: one short factual sentence.
- details: 2-3 factual sentences drawn only from the report.
- source: the reporting body named in the report (e.g. "NDRRMC", "IFRC", "OCHA"), else "ReliefWeb".

Every figure you output must appear in the report text. Use null rather than a guess.`,
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "extraction", strict: true, schema: EXTRACT_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new AiGatewayError(429, "Rate limit reached. Try again shortly.");
    if (res.status === 402)
      throw new AiGatewayError(402, "AI credits exhausted. Add credits in workspace settings.");
    if (res.status === 403)
      throw new AiGatewayError(403, "AI access is blocked for this workspace.");
    throw new AiGatewayError(res.status, `AI gateway error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "") as { events?: Extracted[] };
    return parsed.events ?? [];
  } catch {
    throw new Error("Could not read the extracted report data");
  }
}

// -------------------------------------------------------------- event building

function validArea(e: DisasterEvent): boolean {
  if (e.area_value == null) return true;
  if (!Number.isFinite(e.area_value) || e.area_value <= 0) return false;
  return eventAreaM2(e) < 2_000_000_000_000;
}

/** Builds the full, deduplicated, newest-first list from the real sources. */
export async function buildAllEvents(): Promise<DisasterEvent[]> {
  const [rwResult, gdacsResult] = await Promise.allSettled([
    fetchReliefWeb(),
    fetchGdacsWildfires(),
  ]);

  const gdacs = gdacsResult.status === "fulfilled" ? gdacsResult.value : [];
  const raw = rwResult.status === "fulfilled" ? rwResult.value : [];

  let fromReports: DisasterEvent[] = [];
  if (raw.length > 0) {
    try {
      const extracted = await extractFromReports(raw);
      fromReports = extracted
        .map((x) => {
          const item = raw[x.index];
          if (!item) return null;
          const type = item.kind === "other" ? classify(item.title, item.glide) : item.kind;
          const event: DisasterEvent = {
            title: item.title,
            place: x.place || x.country,
            country: x.country,
            date: item.date,
            type: type === "other" ? "disaster" : type,
            area_value:
              x.area_value != null && Number.isFinite(x.area_value) && x.area_value > 0
                ? x.area_value
                : null,
            area_unit: x.area_unit ?? "hectares",
            lat: x.lat,
            lon: x.lon,
            summary: x.summary,
            source: x.source || "ReliefWeb",
            url: item.url,
            details: x.details,
            people_affected:
              x.people_affected != null && Number.isFinite(x.people_affected)
                ? x.people_affected
                : null,
            people_affected_note: x.people_affected_note ?? "",
          };
          return event;
        })
        .filter(
          (e): e is DisasterEvent =>
            !!e &&
            Number.isFinite(e.lat) &&
            Number.isFinite(e.lon) &&
            Math.abs(e.lat) <= 90 &&
            Math.abs(e.lon) <= 180 &&
            validArea(e),
        );
    } catch (err) {
      // No enrichment available: fall back to the sources that need none.
      if (gdacs.length === 0) throw err;
    }
  }

  const all = [...fromReports, ...gdacs];
  const seen = new Set<string>();
  const deduped = all.filter((e) => {
    const k = `${e.title.toLowerCase()}|${e.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  deduped.sort((a, b) => {
    const d = dateSortKey(b.date) - dateSortKey(a.date);
    if (d !== 0) return d;
    // Within the same day, drawable events first.
    return (b.area_value == null ? 0 : 1) - (a.area_value == null ? 0 : 1);
  });

  if (deduped.length === 0) throw new Error("No recent disaster reports were available.");
  return deduped;
}

function matchesFilter(e: DisasterEvent, type: DisasterFilter): boolean {
  if (type === "any") return true;
  return classify(`${e.type} ${e.title}`) === type;
}

function matchesQuery(e: DisasterEvent, query: string): boolean {
  if (!query) return true;
  const hay = `${e.title} ${e.place} ${e.country} ${e.type} ${e.summary}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

// ---------------------------------------------------------------------- cache

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
 * Returns cached events when they were built on the current New York day,
 * otherwise rebuilds from the live sources. Falls back to a stale row on error.
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
    const all = await buildAllEvents();
    let events = all.filter((e) => matchesFilter(e, type) && matchesQuery(e, queryKey));
    if (events.length === 0 && queryKey) events = all.filter((e) => matchesFilter(e, type));
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

/** Rebuilds every preset filter from one fetch of the live sources. */
export async function refreshDisasterPresets(): Promise<{
  status: string;
  refreshed: string[];
  skipped: string[];
  reason?: string;
}> {
  const state = await readJobState();
  const today = nyDay();

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

  try {
    const all = await buildAllEvents();
    const refreshed: string[] = [];
    for (const filter of DISASTER_FILTERS) {
      await writeCache(
        filter,
        "",
        all.filter((e) => matchesFilter(e, filter)),
      );
      refreshed.push(filter);
    }
    await updateJobState({
      status: "idle",
      paused_reason: null,
      lease_until: null,
      last_ny_day: today,
    });
    return { status: "ok", refreshed, skipped: [] };
  } catch (err) {
    const paused = err instanceof AiGatewayError && (err.status === 402 || err.status === 403);
    await updateJobState({
      status: paused ? "paused" : "idle",
      paused_reason: paused && err instanceof Error ? err.message : null,
      lease_until: null,
    });
    return {
      status: paused ? "paused" : "error",
      refreshed: [],
      skipped: DISASTER_FILTERS,
      reason: err instanceof Error ? err.message : "refresh failed",
    };
  }
}
