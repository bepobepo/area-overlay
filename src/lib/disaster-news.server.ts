// Server-only disaster logic. Events come from GDACS (the Global Disaster Alert
// and Coordination System run by the EU JRC and UN OCHA): real, current events
// with satellite-derived affected-area footprints. No figures are invented.
import * as turf from "@turf/turf";
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

const UA = "area-compare/1.0 (+https://area-compare.lovable.app)";

const TYPE_TO_FILTER: Record<string, DisasterFilter> = {
  FL: "flood",
  FF: "flood",
  TC: "hurricane",
  WF: "wildfire",
  EQ: "earthquake",
  LS: "landslide",
  MS: "landslide",
};

// -------------------------------------------------------------- GDACS sources

type GdacsProps = {
  eventtype?: string;
  eventid?: number;
  episodeid?: number;
  glide?: string;
  name?: string;
  description?: string;
  htmldescription?: string;
  country?: string;
  fromdate?: string;
  todate?: string;
  alertlevel?: string;
  iso3?: string;
  polygonlabel?: string;
  url?: { report?: string; geometry?: string };
  severitydata?: { severity?: number; severityunit?: string; severitytext?: string };
};

type GdacsFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: GdacsProps;
};

async function gdacsJson(url: string): Promise<{ features?: GdacsFeature[] }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`GDACS error ${res.status}`);
  return (await res.json()) as { features?: GdacsFeature[] };
}

/**
 * GDACS caps each response at 100 events and daily wildfire alerts would fill
 * that quota, so each event type is requested separately and merged.
 */
async function fetchEventList(): Promise<GdacsFeature[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);

  const results = await Promise.allSettled(
    ["FL", "TC", "EQ", "WF"].map((t) =>
      gdacsJson(
        "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?" +
          `fromDate=${from}&toDate=${to}&eventlist=${t}&alertlevel=Green;Orange;Red`,
      ),
    ),
  );

  const byId = new Map<string, GdacsFeature>();
  let ok = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    ok += 1;
    for (const f of r.value.features ?? []) {
      const p = f.properties ?? {};
      byId.set(`${p.eventtype}-${p.eventid}`, f);
    }
  }
  if (ok === 0) throw new Error("GDACS unavailable");
  return [...byId.values()];
}



/** Area of the satellite "Affected area" footprint, in m². Null when absent. */
async function affectedAreaM2(p: GdacsProps): Promise<number | null> {
  const geomUrl =
    p.url?.geometry ??
    `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=${p.eventtype}&eventid=${p.eventid}&episodeid=${p.episodeid}`;
  try {
    const json = await gdacsJson(geomUrl);
    let total = 0;
    for (const f of json.features ?? []) {
      const label = f.properties?.polygonlabel ?? "";
      if (!/^Affected area$/i.test(label)) continue;
      if (f.geometry?.type !== "Polygon" && f.geometry?.type !== "MultiPolygon") continue;
      total += turf.area(f as unknown as turf.AllGeoJSON);
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

function niceArea(m2: number): { value: number; unit: DisasterEvent["area_unit"] } {
  const km2 = m2 / 1_000_000;
  if (km2 >= 10) return { value: Math.round(km2), unit: "km2" };
  return { value: Math.round(m2 / 10_000), unit: "hectares" };
}

function reportLink(p: GdacsProps): string {
  const glide = (p.glide ?? "").trim();
  if (/^[A-Z]{2}-\d{4}-\d{6}-[A-Z]{3}$/.test(glide))
    return `https://reliefweb.int/disaster/${glide.toLowerCase()}`;
  return (
    p.url?.report ??
    `https://www.gdacs.org/report.aspx?eventid=${p.eventid}&eventtype=${p.eventtype}`
  );
}

function keepEvent(p: GdacsProps): boolean {
  const sev = p.severitydata?.severity ?? 0;
  switch (p.eventtype) {
    case "EQ":
      // Only quakes big enough to be widely reported.
      return sev >= 5.5;
    case "WF":
      return sev >= 100; // hectares burnt
    default:
      return true;
  }
}

/** Short human line; GDACS reports "Magnitude 0" for events without a scale. */
function cleanSummary(p: GdacsProps, filter: DisasterFilter): string {
  const sev = (p.severitydata?.severitytext ?? "").trim();
  if (sev && !/magnitude\s*0\b/i.test(sev)) return sev;
  const alert = p.alertlevel ? `${p.alertlevel} alert` : "Monitored event";
  return `${alert} — ${filter} in ${p.country || "an unnamed area"}`;
}

function describe(p: GdacsProps, areaText: string): string {
  const where = p.country ?? "the affected area";
  const when = (p.fromdate ?? "").slice(0, 10);
  const sev = p.severitydata?.severitytext ? ` ${p.severitydata.severitytext}.` : "";
  const alert = p.alertlevel ? `${p.alertlevel} alert level.` : "";
  return (
    `${p.name ?? "Event"} in ${where}, recorded from ${when}.${sev} ${areaText} ` +
    `${alert} Monitored by GDACS, the Global Disaster Alert and Coordination System ` +
    `(EU Joint Research Centre and UN OCHA).`
  ).replace(/\s+/g, " ");
}

/** Builds the current, newest-first list of real events. */
export async function buildAllEvents(): Promise<DisasterEvent[]> {
  const features = await fetchEventList();

  // Keep the newest events of each type, so daily wildfire alerts don't crowd
  // out floods, storms and quakes.
  const perType: Record<string, number> = { WF: 18, FL: 40, TC: 12, EQ: 12 };
  const counts: Record<string, number> = {};
  const candidates = features
    .map((f) => ({ f, p: f.properties ?? {} }))
    .filter(({ p }) => p.eventtype && TYPE_TO_FILTER[p.eventtype] && keepEvent(p))
    .sort((a, b) => (b.p.fromdate ?? "").localeCompare(a.p.fromdate ?? ""))
    .filter(({ p }) => {
      const t = p.eventtype!;
      counts[t] = (counts[t] ?? 0) + 1;
      return counts[t] <= (perType[t] ?? 10);
    });


  console.log("cand", candidates.map((c) => c.p.eventtype).join(","));
  const events: DisasterEvent[] = [];
  const queue = [...candidates];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const { f, p } = next;
      const filter = TYPE_TO_FILTER[p.eventtype!]!;
      const coords = (f.geometry as { coordinates?: [number, number] } | undefined)?.coordinates;
      const sev = p.severitydata?.severity ?? 0;

      let area: { value: number; unit: DisasterEvent["area_unit"] } | null = null;
      if (p.eventtype === "WF" && sev >= 100) {
        area = { value: Math.round(sev), unit: "hectares" };
      } else {
        const m2 = await affectedAreaM2(p);
        if (m2) area = niceArea(m2);
      }

      const areaText = area
        ? `Mapped affected area of about ${area.value.toLocaleString()} ${
            area.unit === "km2" ? "km²" : "hectares"
          }.`
        : "No affected-area footprint has been published for this event yet.";

      const date = (p.fromdate ?? "").slice(0, 10) || nyDay();
      events.push({
        title: p.name || p.description || `${filter} in ${p.country ?? "unknown"}`,
        place: p.country ?? "",
        country: "",
        date,
        type: filter,
        area_value: area?.value ?? null,
        area_unit: area?.unit ?? "km2",
        lat: Array.isArray(coords) ? Number(coords[1]) : NaN,
        lon: Array.isArray(coords) ? Number(coords[0]) : NaN,
        summary: cleanSummary(p, filter),
        source: "GDACS (EU JRC / UN OCHA)",
        url: reportLink(p),
        details: describe(p, areaText),
        people_affected: null,
        people_affected_note: "",
      });
    }
  }

  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

  const seen = new Set<string>();
  const out = events.filter(
    (e) =>
      Number.isFinite(e.lat) &&
      Number.isFinite(e.lon) &&
      Math.abs(e.lat) <= 90 &&
      Math.abs(e.lon) <= 180 &&
      (e.area_value == null || (e.area_value > 0 && eventAreaM2(e) < 2_000_000_000_000)) &&
      (() => {
        const k = `${e.title.toLowerCase()}|${e.date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })(),
  );

  out.sort((a, b) => {
    // Events with a measured footprint first within the same day.
    const d = dateSortKey(b.date) - dateSortKey(a.date);
    if (d !== 0) return d;
    return (b.area_value == null ? 0 : 1) - (a.area_value == null ? 0 : 1);
  });

  if (out.length === 0) throw new Error("No current disaster events were available.");
  return out;
}

function matchesFilter(e: DisasterEvent, type: DisasterFilter): boolean {
  return type === "any" || e.type === type;
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
 * otherwise rebuilds from the live source. Falls back to a stale row on error.
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

/** Rebuilds every preset filter from one fetch of the live source. */
export async function refreshDisasterPresets(): Promise<{
  status: string;
  refreshed: string[];
  skipped: string[];
  reason?: string;
}> {
  const state = await readJobState();
  const today = nyDay();

  if (state?.last_ny_day === today) {
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
    const reason = err instanceof Error ? err.message : "refresh failed";
    await updateJobState({ status: "idle", paused_reason: reason, lease_until: null });
    return { status: "error", refreshed: [], skipped: DISASTER_FILTERS, reason };
  }
}
