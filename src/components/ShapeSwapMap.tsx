import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";
import { useServerFn } from "@tanstack/react-start";
import { searchPlaces, type GeocodeResult } from "@/lib/geocode.functions";
import { generateShape } from "@/lib/ai-shape.functions";
import {
  searchDisasters,
  eventAreaM2,
  type DisasterEvent,
} from "@/lib/disaster-news.functions";

type LngLat = [number, number];
type Mode = "idle" | "drawing" | "locked";
type ShapeTarget = "overlay" | "original";

const MAPTILER_KEY = "PHdof98UIhcQKfX6LgHd";
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
const STORAGE_KEY = "shapeswap.polygon.v1";
const ONBOARDING_BUTTONS_KEY = "shapeswap.onboarding.buttonsDismissed.v1";
const ONBOARDING_SEARCH_KEY = "shapeswap.onboarding.searchDismissed.v1";


/** Translate a polygon so its centroid is at newCenter, preserving real-world size. */
function translatePolygon(ring: LngLat[], newCenter: LngLat): LngLat[] {
  if (ring.length < 3) return ring;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring
    : [...ring, ring[0]];
  const poly = turf.polygon([closed.map((p) => [p[0], p[1]])]);
  const c = turf.centroid(poly).geometry.coordinates as LngLat;
  return ring.map((pt) => {
    const dist = turf.distance([c[0], c[1]], [pt[0], pt[1]], { units: "kilometers" });
    const bearing = turf.bearing([c[0], c[1]], [pt[0], pt[1]]);
    const moved = turf.destination(newCenter, dist, bearing, { units: "kilometers" });
    return moved.geometry.coordinates as LngLat;
  });
}

/** Convert polygon points in meters (centroid at 0,0) to lng/lat around center. */
function metersPolygonToLngLat(points: Array<{ x: number; y: number }>, center: LngLat): LngLat[] {
  return points.map((p) => {
    const distM = Math.sqrt(p.x * p.x + p.y * p.y);
    // bearing: 0 = north, 90 = east. x=east, y=north.
    const bearing = (Math.atan2(p.x, p.y) * 180) / Math.PI;
    if (distM === 0) return center;
    const moved = turf.destination(center, distM / 1000, bearing, { units: "kilometers" });
    return moved.geometry.coordinates as LngLat;
  });
}

/** Centroid of a ring. */
function ringCentroid(ring: LngLat[]): LngLat {
  const closed =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  return turf.centroid(turf.polygon([closed])).geometry.coordinates as LngLat;
}

/** Rotate a ring by `deg` clockwise around a pivot, preserving real-world size. */
function rotateRing(ring: LngLat[], deg: number, pivot: LngLat): LngLat[] {
  if (!deg || ring.length < 3) return ring;
  return ring.map((pt) => {
    const dist = turf.distance(pivot, pt, { units: "kilometers" });
    if (dist === 0) return pt;
    const bearing = turf.bearing(pivot, pt) + deg;
    return turf.destination(pivot, dist, bearing, { units: "kilometers" }).geometry
      .coordinates as LngLat;
  });
}

/** The overlay ring = original ring translated to overlayCenter, then rotated. */
function computeOverlayRing(ring: LngLat[], center: LngLat, rotation: number): LngLat[] {
  return rotateRing(translatePolygon(ring, center), rotation, center);
}

/** A soft irregular blob polygon with the given real-world area (m²), centered at `center`. */
function blobForArea(areaM2: number, center: LngLat, seed = 1): LngLat[] {
  const r = Math.sqrt(Math.max(areaM2, 1) / Math.PI);
  const n = 28;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble =
      1 +
      0.12 * Math.sin(t * 3 + seed) +
      0.07 * Math.sin(t * 5 + seed * 2) +
      0.04 * Math.sin(t * 7 + seed * 3);
    const rr = r * wobble;
    pts.push({ x: Math.sin(t) * rr, y: Math.cos(t) * rr });
  }
  return metersPolygonToLngLat(pts, center);
}






function ringArea(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const closed =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  try {
    return turf.area(turf.polygon([closed]));
  } catch {
    return 0;
  }
}

function formatArea(m2: number): string {
  if (m2 <= 0) return "—";
  const km2 = m2 / 1_000_000;
  if (km2 >= 1) return `${km2.toFixed(2)} km²`;
  const ha = m2 / 10_000;
  if (ha >= 1) return `${ha.toFixed(2)} ha`;
  return `${Math.round(m2)} m²`;
}

export function ShapeSwapMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawingRef = useRef<LngLat[]>([]);
  const modeRef = useRef<Mode>("idle");
  const overlayCenterRef = useRef<LngLat | null>(null);
  const originalRingRef = useRef<LngLat[] | null>(null);
  const dragTargetRef = useRef<ShapeTarget>("overlay");
  const draggingRef = useRef(false);
  const freehandRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeShapeRef = useRef<ShapeTarget | null>(null);
  const overlayRotationRef = useRef(0);
  const rotatingRef = useRef(false);
  const rotateStartRef = useRef<{
    pivot: LngLat;
    startBearing: number;
    baseRing: LngLat[];
    baseRotation: number;
  } | null>(null);
  const handleElRef = useRef<HTMLDivElement>(null);
  const handleBtnRef = useRef<HTMLButtonElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      map.setPaintProperty("overlay-fill", "fill-opacity", isDragging ? 0.5 : 0.3);
      map.setPaintProperty("overlay-line", "line-width", isDragging ? 4 : 3);
    } catch {}
  }, [isDragging]);

  const [mode, setMode] = useState<Mode>("idle");
  const [originalRing, setOriginalRing] = useState<LngLat[] | null>(null);
  const [overlayCenter, setOverlayCenter] = useState<LngLat | null>(null);
  const [overlayRotation, setOverlayRotation] = useState(0);
  const [activeShape, setActiveShape] = useState<ShapeTarget | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<LngLat[]>([]);

  const search = useServerFn(searchPlaces);
  const genShape = useServerFn(generateShape);
  const findDisasters = useServerFn(searchDisasters);

  // AI dialog state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Disaster-news dialog state
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsType, setNewsType] = useState<
    "any" | "wildfire" | "flood" | "hurricane" | "landslide" | "earthquake"
  >("any");
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsEvents, setNewsEvents] = useState<DisasterEvent[]>([]);
  const [detailEvent, setDetailEvent] = useState<DisasterEvent | null>(null);
  const [shapeLabel, setShapeLabel] = useState<string | null>(null);


  // Onboarding — two independent dismissal flags
  const [buttonsTipDismissed, setButtonsTipDismissed] = useState(true);
  const [searchTipDismissed, setSearchTipDismissed] = useState(true);
  useEffect(() => {
    try {
      setButtonsTipDismissed(localStorage.getItem(ONBOARDING_BUTTONS_KEY) === "1");
      setSearchTipDismissed(localStorage.getItem(ONBOARDING_SEARCH_KEY) === "1");
    } catch {}
  }, []);
  const dismissButtonsTip = useCallback(() => {
    setButtonsTipDismissed(true);
    try {
      localStorage.setItem(ONBOARDING_BUTTONS_KEY, "1");
    } catch {}
  }, []);
  const dismissSearchTip = useCallback(() => {
    setSearchTipDismissed(true);
    try {
      localStorage.setItem(ONBOARDING_SEARCH_KEY, "1");
    } catch {}
  }, []);
  // Auto-dismiss the search tip once an overlay is placed
  useEffect(() => {
    if (overlayCenter && !searchTipDismissed) dismissSearchTip();
  }, [overlayCenter, searchTipDismissed, dismissSearchTip]);

  const runAiGenerate = useCallback(async () => {
    const map = mapRef.current;
    const desc = aiDescription.trim();
    if (!map || !desc) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const shape = await genShape({ data: { description: desc } });
      const c = map.getCenter();
      const ring = metersPolygonToLngLat(shape.points_m, [c.lng, c.lat]);
      setOriginalRing(ring);
      setOverlayCenter([c.lng, c.lat]);
      setOverlayRotation(0);
      setShapeLabel(shape.label || desc);
      setMode("locked");
      setAiOpen(false);
      setAiDescription("");
      // fit bounds
      const closed = [...ring, ring[0]];
      const bbox = turf.bbox(turf.polygon([closed])) as [number, number, number, number];
      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, duration: 800 });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAiLoading(false);
    }
  }, [aiDescription, genShape]);

  const loadNews = useCallback(
    async (type: typeof newsType) => {
      setNewsLoading(true);
      setNewsError(null);
      setNewsEvents([]);
      try {
        const events = await findDisasters({ data: { type } });
        setNewsEvents(events);
      } catch (e) {
        setNewsError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setNewsLoading(false);
      }
    },
    [findDisasters],
  );

  const pickDisaster = useCallback((e: DisasterEvent) => {
    const map = mapRef.current;
    if (!map) return;
    const center: LngLat = [e.lon, e.lat];
    const ring = blobForArea(eventAreaM2(e), center, e.title.length % 7);
    setOriginalRing(ring);
    setOverlayCenter(center);
    setOverlayRotation(0);
    setActiveShape(null);
    setShapeLabel(`${e.title} · ${e.area_value.toLocaleString()} ${e.area_unit}`);
    setMode("locked");
    setNewsOpen(false);
    const closed = [...ring, ring[0]];
    const bbox = turf.bbox(turf.polygon([closed])) as [number, number, number, number];
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 900 });
  }, []);

  // keep refs in sync
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    overlayCenterRef.current = overlayCenter;
  }, [overlayCenter]);
  useEffect(() => {
    originalRingRef.current = originalRing;
  }, [originalRing]);
  useEffect(() => {
    activeShapeRef.current = activeShape;
  }, [activeShape]);
  useEffect(() => {
    overlayRotationRef.current = overlayRotation;
  }, [overlayRotation]);


  // Init map (client only)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: [-0.0396, 51.5362], // Victoria Park, London
      zoom: 13,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const resizeMap = () => map.resize();
    requestAnimationFrame(resizeMap);
    const resizeObserver = new ResizeObserver(resizeMap);
    resizeObserver.observe(container);

    map.on("load", () => {
      // Original polygon layers
      map.addSource("original", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "original-fill",
        type: "fill",
        source: "original",
        paint: { "fill-color": "#22d3ee", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "original-line",
        type: "line",
        source: "original",
        paint: { "line-color": "#06b6d4", "line-width": 3 },
      });

      // Drawing preview
      map.addSource("drawing", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "drawing-fill",
        type: "fill",
        source: "drawing",
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": "#22d3ee", "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: "drawing-line",
        type: "line",
        source: "drawing",
        filter: ["==", "$type", "LineString"],
        paint: { "line-color": "#22d3ee", "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "drawing-points",
        type: "circle",
        source: "drawing",
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#0ea5e9",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });


      // Overlay polygon
      map.addSource("overlay", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "overlay-fill",
        type: "fill",
        source: "overlay",
        paint: { "fill-color": "#f472b6", "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "overlay-line",
        type: "line",
        source: "overlay",
        paint: {
          "line-color": "#ec4899",
          "line-width": 3,
          "line-dasharray": [3, 2],
        },
      });





      // restore saved polygon
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as LngLat[];
          if (Array.isArray(parsed) && parsed.length >= 3) {
            setOriginalRing(parsed);
            setMode("locked");
          }
        }
      } catch {}
    });

    // Long-press to drag the overlay polygon
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE = 8;
    const FREEHAND_MIN_PX = 6;
    let pressStart: { x: number; y: number } | null = null;
    let lastFreehandPx: { x: number; y: number } | null = null;

    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      pressStart = null;
    };

    const finishFreehand = () => {
      if (!freehandRef.current) return;
      freehandRef.current = false;
      map.dragPan.enable();
      // stay in drawing mode — keep the crosshair cursor so the user knows
      // they can redraw. Locking happens when the user hits "Ready".
      map.getCanvas().style.cursor = modeRef.current === "drawing" ? "crosshair" : "";
      lastFreehandPx = null;
      setDrawingPoints([...drawingRef.current]);
    };


    const endDrag = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        setIsDragging(false);
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
      }
      if (rotatingRef.current) {
        rotatingRef.current = false;
        rotateStartRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
      }
      finishFreehand();
      cancelLongPress();
    };

    /** Current on-screen ring of a target shape. */
    const currentRing = (target: ShapeTarget): LngLat[] | null => {
      const ring = originalRingRef.current;
      if (!ring || ring.length < 3) return null;
      if (target === "original") return ring;
      const c = overlayCenterRef.current;
      if (!c) return null;
      return computeOverlayRing(ring, c, overlayRotationRef.current);
    };

    const handlePressStart = (
      point: { x: number; y: number },
      lngLat: { lng: number; lat: number },
    ) => {
      if (modeRef.current === "drawing") {
        map.dragPan.disable();
        map.getCanvas().style.cursor = "crosshair";
        freehandRef.current = true;
        const pt: LngLat = [lngLat.lng, lngLat.lat];
        drawingRef.current = [pt];
        setDrawingPoints([pt]);
        lastFreehandPx = { x: point.x, y: point.y };
        return;
      }
      if (modeRef.current !== "locked") return;

      // Rotation is started by the DOM rotate handle (see below), not here.


      const layers: string[] = [];
      if (overlayCenterRef.current) layers.push("overlay-fill");
      if (originalRingRef.current) layers.push("original-fill");
      if (layers.length === 0) return;
      const hits = map.queryRenderedFeatures(
        [point.x, point.y] as unknown as maplibregl.PointLike,
        { layers },
      );
      if (hits.length === 0) {
        // Tapping empty map dismisses the rotate handle.
        if (activeShapeRef.current) setActiveShape(null);
        return;
      }
      const hitOverlay = hits.some((h) => h.layer.id === "overlay-fill");
      dragTargetRef.current = hitOverlay ? "overlay" : "original";
      pressStart = { x: point.x, y: point.y };
      longPressTimerRef.current = setTimeout(() => {
        draggingRef.current = true;
        setIsDragging(true);
        setActiveShape(dragTargetRef.current);
        map.dragPan.disable();
        map.getCanvas().style.cursor = "grabbing";
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS);
      void lngLat;
    };

    const handlePressMove = (
      point: { x: number; y: number },
      lngLat: { lng: number; lat: number },
    ) => {
      if (freehandRef.current) {
        if (lastFreehandPx) {
          const dx = point.x - lastFreehandPx.x;
          const dy = point.y - lastFreehandPx.y;
          if (dx * dx + dy * dy < FREEHAND_MIN_PX * FREEHAND_MIN_PX) return;
        }
        lastFreehandPx = { x: point.x, y: point.y };
        const pt: LngLat = [lngLat.lng, lngLat.lat];
        drawingRef.current = [...drawingRef.current, pt];
        setDrawingPoints([...drawingRef.current]);
        return;
      }
      if (rotatingRef.current && rotateStartRef.current) {
        const { pivot, startBearing, baseRing, baseRotation } = rotateStartRef.current;
        const bearing = turf.bearing(pivot, [lngLat.lng, lngLat.lat]);
        let angle = baseRotation + (bearing - startBearing);
        // light snap to the cardinal angles
        const norm = ((angle % 360) + 360) % 360;
        for (const snap of [0, 90, 180, 270, 360]) {
          if (Math.abs(norm - snap) <= 2.5) {
            angle += snap - norm;
            break;
          }
        }
        if (dragTargetRef.current === "overlay") {
          overlayRotationRef.current = angle;
          setOverlayRotation(angle);
        } else {
          const rotated = rotateRing(baseRing, angle, pivot);
          originalRingRef.current = rotated;
          setOriginalRing(rotated);
        }
        return;
      }
      if (draggingRef.current) {
        if (dragTargetRef.current === "overlay") {
          setOverlayCenter([lngLat.lng, lngLat.lat]);
        } else {
          const ring = originalRingRef.current;
          if (ring && ring.length >= 3) {
            const moved = translatePolygon(ring, [lngLat.lng, lngLat.lat]);
            originalRingRef.current = moved;
            setOriginalRing(moved);
          }
        }
        return;
      }
      if (pressStart) {
        const dx = point.x - pressStart.x;
        const dy = point.y - pressStart.y;
        if (dx * dx + dy * dy > MOVE_TOLERANCE * MOVE_TOLERANCE) cancelLongPress();
      }
    };



    map.on("mousedown", (e) => handlePressStart(e.point, e.lngLat));
    map.on("mousemove", (e) => handlePressMove(e.point, e.lngLat));
    map.on("touchstart", (e) => {
      if (e.points.length !== 1) {
        cancelLongPress();
        return;
      }
      handlePressStart(e.point, e.lngLat);
    });
    map.on("touchmove", (e) => {
      if (e.points.length !== 1) {
        cancelLongPress();
        return;
      }
      handlePressMove(e.point, e.lngLat);
    });

    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("touchcancel", endDrag);

    // --- Rotate handle (DOM overlay, screen-anchored above the shape) ---
    const positionRotateHandle = () => {
      const el = handleElRef.current;
      if (!el) return;
      const active = activeShapeRef.current;
      const ring = active ? currentRing(active) : null;
      if (!ring || ring.length < 3) {
        el.style.display = "none";
        return;
      }
      let minY = Infinity;
      let sumX = 0;
      for (const c of ring) {
        const p = map.project(c);
        if (p.y < minY) minY = p.y;
        sumX += p.x;
      }
      el.style.display = "block";
      el.style.transform = `translate(${sumX / ring.length}px, ${minY}px)`;
    };
    map.on("render", positionRotateHandle);

    const pointerToMap = (clientX: number, clientY: number) => {
      const rect = map.getCanvas().getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const ll = map.unproject([x, y]);
      return { point: { x, y }, lngLat: { lng: ll.lng, lat: ll.lat } };
    };

    const onHandleDown = (ev: PointerEvent) => {
      const active = activeShapeRef.current;
      if (!active) return;
      const ring = currentRing(active);
      if (!ring) return;
      ev.preventDefault();
      ev.stopPropagation();
      const { lngLat } = pointerToMap(ev.clientX, ev.clientY);
      const pivot = ringCentroid(ring);
      rotatingRef.current = true;
      rotateStartRef.current = {
        pivot,
        startBearing: turf.bearing(pivot, [lngLat.lng, lngLat.lat]),
        baseRing: originalRingRef.current ?? ring,
        baseRotation: active === "overlay" ? overlayRotationRef.current : 0,
      };
      dragTargetRef.current = active;
      map.dragPan.disable();
    };

    const onWindowPointerMove = (ev: PointerEvent) => {
      if (!rotatingRef.current) return;
      ev.preventDefault();
      const { point, lngLat } = pointerToMap(ev.clientX, ev.clientY);
      handlePressMove(point, lngLat);
    };
    const onWindowPointerUp = () => {
      if (rotatingRef.current) endDrag();
    };

    const handleBtn = handleBtnRef.current;
    handleBtn?.addEventListener("pointerdown", onHandleDown);
    window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);

    return () => {
      cancelLongPress();
      resizeObserver.disconnect();
      handleBtn?.removeEventListener("pointerdown", onHandleDown);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      map.remove();
      mapRef.current = null;
    };
  }, []);


  // Reflect drawing mode on the map cursor
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = mode === "drawing" ? "crosshair" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [mode]);

  // Update drawing source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("drawing") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = [];

    if (drawingPoints.length >= 3) {
      const closed = [...drawingPoints, drawingPoints[0]];
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [closed] },
        properties: {},
      });
    } else if (drawingPoints.length === 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: drawingPoints },
        properties: {},
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [drawingPoints]);


  // Update original polygon source
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("original") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!originalRing || originalRing.length < 3) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const closed = [...originalRing, originalRing[0]];
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [closed] },
            properties: {},
          },
        ],
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [originalRing]);

  // Update overlay polygon
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("overlay") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!originalRing || !overlayCenter) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const moved = computeOverlayRing(originalRing, overlayCenter, overlayRotation);
      const closed = [...moved, moved[0]];
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [closed] },
            properties: {},
          },
        ],
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [originalRing, overlayCenter, overlayRotation]);

  // Keep the rotate handle glued to the shape when React state changes
  useEffect(() => {
    mapRef.current?.triggerRepaint();
  }, [activeShape, originalRing, overlayCenter, overlayRotation]);




  // Persist original polygon
  useEffect(() => {
    if (originalRing && originalRing.length >= 3) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(originalRing));
      } catch {}
    }
  }, [originalRing]);

  // Search debounce
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await search({ data: { q: query.trim() } });
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, search]);

  const startDrawing = useCallback(() => {
    drawingRef.current = [];
    setDrawingPoints([]);
    setOriginalRing(null);
    setOverlayCenter(null);
    setOverlayRotation(0);
    setActiveShape(null);
    setShapeLabel(null);
    setMode("drawing");
  }, []);

  const finishDrawing = useCallback(() => {
    if (drawingRef.current.length < 3) return;
    setOriginalRing([...drawingRef.current]);
    drawingRef.current = [];
    setDrawingPoints([]);
    setMode("locked");
  }, []);



  const clearAll = useCallback(() => {
    drawingRef.current = [];
    setDrawingPoints([]);
    setOriginalRing(null);
    setOverlayCenter(null);
    setOverlayRotation(0);
    setActiveShape(null);
    setShapeLabel(null);
    setQuery("");
    setResults([]);
    setMode("idle");
    // Force-clear map sources immediately (don't rely on effect timing)
    const map = mapRef.current;
    if (map) {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of ["original", "overlay", "drawing"] as const) {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(empty);
      }
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);


  const pickResult = useCallback(
    (r: GeocodeResult) => {
      const map = mapRef.current;
      if (!map) return;
      setQuery(r.label.split(",")[0]);
      setShowResults(false);
      if (mode === "locked" && originalRing) {
        setOverlayCenter([r.lon, r.lat]);
        map.flyTo({ center: [r.lon, r.lat], zoom: 13, essential: true });
      } else {
        map.flyTo({ center: [r.lon, r.lat], zoom: 13, essential: true });
      }
    },
    [mode, originalRing],
  );

  const area = originalRing ? formatArea(ringArea(originalRing)) : "—";

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <div
        ref={containerRef}
        data-map-container
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* Rotate handle, screen-anchored just above the active shape */}
      <div
        ref={handleElRef}
        className="pointer-events-none absolute left-0 top-0 z-10"
        style={{ display: "none" }}
      >
        <div className="absolute bottom-0 left-0 h-[26px] w-px -translate-x-1/2 bg-foreground/50" />
        <button
          ref={handleBtnRef}
          type="button"
          aria-label="Rotate shape"
          title="Drag to rotate"
          className="pointer-events-auto absolute bottom-[26px] left-0 flex h-9 w-9 -translate-x-1/2 touch-none items-center justify-center rounded-full bg-background text-foreground shadow-lg ring-1 ring-black/15 active:bg-accent"
        >
          <RotateCw size={16} />
        </button>
      </div>


      {/* Top: search */}
      <div className="relative z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="relative rounded-2xl bg-background/85 backdrop-blur-md shadow-lg ring-1 ring-black/10">
          {mode === "locked" && !searchTipDismissed && !overlayCenter && (
            <span aria-hidden className="highlight-frame-cyan" />
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder={
                mode === "locked"
                  ? "Search a place to overlay your shape…"
                  : "Search any address or place…"
              }
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              inputMode="search"
              autoComplete="off"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setResults([]);
                }}
                className="text-muted-foreground text-xs px-2"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {showResults && (results.length > 0 || searching) && (
            <div className="border-t border-black/5 max-h-72 overflow-y-auto">
              {searching && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
              )}
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => pickResult(r)}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent border-t border-black/5 first:border-t-0"
                >
                  <div className="line-clamp-2">{r.label}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {mode === "locked" && !searchTipDismissed && !overlayCenter && (
          <div className="mt-2 flex flex-col items-center">
            <div className="h-2 w-2 rotate-45 bg-cyan-600 -mb-1" />
            <div className="max-w-[22rem] rounded-xl bg-cyan-600 text-white text-xs px-3 py-2 shadow-lg flex items-center gap-2">
              <span aria-hidden>🔍</span>
              <span>Now search for a place on the map to compare it to.</span>
              <button
                onClick={dismissSearchTip}
                className="ml-1 text-white/80 hover:text-white text-[10px] uppercase tracking-wide"
                aria-label="Dismiss tip"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>



      {/* Legend chip */}
      {(originalRing || overlayCenter) && (
        <div className="relative z-10 mx-3 -mt-1 flex flex-wrap gap-2">
          {originalRing && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background/85 backdrop-blur px-2.5 py-1 text-xs shadow ring-1 ring-black/10">
              <span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" />
              Original · {area}
            </span>
          )}
          {overlayCenter && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-background/85 backdrop-blur px-2.5 py-1 text-xs shadow ring-1 ring-black/10">
              <span className="h-2.5 w-2.5 rounded-sm bg-pink-500" />
              Overlay
              {overlayRotation ? ` · ${Math.round(((overlayRotation % 360) + 360) % 360)}°` : ""}
            </span>
          )}
          {shapeLabel && (
            <span className="inline-flex max-w-[70vw] items-center gap-1.5 truncate rounded-full bg-background/85 backdrop-blur px-2.5 py-1 text-xs shadow ring-1 ring-black/10">
              <span aria-hidden>🏷️</span>
              <span className="truncate">{shapeLabel}</span>
            </span>
          )}
        </div>
      )}


      {/* Bottom sheet */}
      <div className="mt-auto relative z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="relative rounded-2xl bg-background/90 backdrop-blur-md shadow-xl ring-1 ring-black/10 p-3">
          {mode === "idle" && !buttonsTipDismissed && (
            <span aria-hidden className="highlight-frame-fuchsia" />
          )}
          {mode === "idle" && !buttonsTipDismissed && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none">
              <div className="pointer-events-auto max-w-[18rem] rounded-xl bg-fuchsia-600 text-white text-xs px-3 py-2 shadow-lg flex items-center gap-2">
                <span aria-hidden>👋</span>
                <span>Start by drawing a shape or letting AI do it for you.</span>
                <button
                  onClick={dismissButtonsTip}
                  className="ml-1 text-white/80 hover:text-white text-[10px] uppercase tracking-wide"
                  aria-label="Dismiss tip"
                >
                  Got it
                </button>
              </div>
              <div className="h-2 w-2 rotate-45 bg-fuchsia-600 -mt-1" />
            </div>
          )}
          {mode === "idle" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground px-1">
                Draw a shape around any area to get started.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={startDrawing}
                  className="flex-1 rounded-xl bg-cyan-600 hover:bg-cyan-700 active:bg-cyan-800 text-white font-medium py-3 text-sm transition"
                >
                  Draw on map
                </button>
                <button
                  onClick={() => {
                    setAiError(null);
                    setAiOpen(true);
                  }}
                  className="flex-1 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 active:bg-fuchsia-800 text-white font-medium py-3 text-sm transition inline-flex items-center justify-center gap-1.5"
                >
                  <span aria-hidden>✨</span> Draw with AI
                </button>
              </div>
              <button
                onClick={() => {
                  setNewsOpen(true);
                  if (newsEvents.length === 0 && !newsLoading) void loadNews(newsType);
                }}
                className="rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-medium py-3 text-sm transition inline-flex items-center justify-center gap-1.5"
              >
                <span aria-hidden>🔥</span> Disaster areas from the news
              </button>
            </div>
          )}



          {mode === "drawing" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground px-1">
                {drawingPoints.length >= 3
                  ? "Looks good? Tap Ready — or draw again to redo."
                  : "Press and drag on the map to trace a shape freehand."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={clearAll}
                  className="flex-1 rounded-xl bg-secondary text-secondary-foreground font-medium py-3 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={finishDrawing}
                  disabled={drawingPoints.length < 3}
                  className="flex-[1.4] rounded-xl bg-cyan-600 hover:bg-cyan-700 active:bg-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 text-sm transition"
                >
                  Ready
                </button>
              </div>
            </div>
          )}



          {mode === "locked" && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground px-1">
                {activeShape
                  ? "Drag to move it, or drag the round handle to rotate. Tap the map to release."
                  : overlayCenter
                    ? "Long-press any shape to drag or rotate it, or search a new place."
                    : "Now search a place above to overlay your shape there."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const map = mapRef.current;
                    if (map && originalRing) {
                      const closed = [...originalRing, originalRing[0]];
                      const bbox = turf.bbox(turf.polygon([closed])) as [number, number, number, number];
                      map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 800 });
                    }
                  }}
                  className="flex-1 rounded-xl bg-secondary text-secondary-foreground font-medium py-3 text-sm"
                >
                  View original
                </button>
                {overlayCenter && (
                  <button
                    onClick={() => {
                      const map = mapRef.current;
                      if (map && originalRing && overlayCenter) {
                        const moved = computeOverlayRing(originalRing, overlayCenter, overlayRotation);
                        const closed = [...moved, moved[0]];
                        const bbox = turf.bbox(turf.polygon([closed])) as [number, number, number, number];
                        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 800 });
                      }
                    }}
                    className="flex-1 rounded-xl bg-secondary text-secondary-foreground font-medium py-3 text-sm"
                  >
                    View overlay
                  </button>
                )}

                <button
                  onClick={clearAll}
                  className="flex-1 rounded-xl bg-destructive/90 hover:bg-destructive text-white font-medium py-3 text-sm"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-3">
          <div className="w-full max-w-md rounded-2xl bg-background shadow-2xl ring-1 ring-black/10 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Draw with AI</h2>
              <button
                onClick={() => !aiLoading && setAiOpen(false)}
                className="text-muted-foreground text-lg leading-none px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Describe an area or object and AI will estimate its real-world size and draw it on the map.
            </p>
            <textarea
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              disabled={aiLoading}
              rows={3}
              placeholder="e.g. 5 shipping containers, a football pitch, a Boeing 747"
              className="w-full rounded-xl border border-black/10 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-fuchsia-500/50 resize-none"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5">
              {["5 shipping containers", "A football pitch", "A Boeing 747", "An Olympic swimming pool"].map((s) => (
                <button
                  key={s}
                  onClick={() => setAiDescription(s)}
                  disabled={aiLoading}
                  className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            {aiError && (
              <p className="text-xs text-destructive">{aiError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setAiOpen(false)}
                disabled={aiLoading}
                className="flex-1 rounded-xl bg-secondary text-secondary-foreground font-medium py-3 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runAiGenerate}
                disabled={aiLoading || !aiDescription.trim()}
                className="flex-[1.4] rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-medium py-3 text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {aiLoading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>✨ Generate</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {newsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-3">
          <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-background shadow-2xl ring-1 ring-black/10 p-4 gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Disaster areas from the news</h2>
              <button
                onClick={() => {
                  setNewsOpen(false);
                  setDetailEvent(null);
                }}
                className="text-muted-foreground text-lg leading-none px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {detailEvent ? (
              <div className="flex-1 overflow-y-auto -mx-1 px-1">
                <button
                  onClick={() => setDetailEvent(null)}
                  className="text-xs text-muted-foreground hover:text-foreground mb-2"
                >
                  ← Back to events
                </button>
                <h3 className="text-sm font-semibold">{detailEvent.title}</h3>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {detailEvent.place}
                  {detailEvent.country ? `, ${detailEvent.country}` : ""} · {detailEvent.date} ·{" "}
                  {detailEvent.type}
                </div>
                <p className="text-xs mt-3 leading-relaxed">
                  {detailEvent.details || detailEvent.summary}
                </p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Affected area</dt>
                    <dd className="font-medium text-amber-700 text-right">
                      {detailEvent.area_value.toLocaleString()} {detailEvent.area_unit} ·{" "}
                      {formatArea(eventAreaM2(detailEvent))}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">People affected</dt>
                    <dd className="font-medium text-right">
                      {typeof detailEvent.people_affected === "number" &&
                      Number.isFinite(detailEvent.people_affected)
                        ? `${detailEvent.people_affected.toLocaleString()}${
                            detailEvent.people_affected_note
                              ? ` ${detailEvent.people_affected_note}`
                              : ""
                          }`
                        : "Not reported"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="text-right">
                      {detailEvent.source && detailEvent.source !== "unknown"
                        ? detailEvent.source
                        : "Not reported"}
                    </dd>
                  </div>
                </dl>
                <button
                  onClick={() => {
                    const e = detailEvent;
                    setDetailEvent(null);
                    pickDisaster(e);
                  }}
                  className="mt-4 w-full rounded-xl bg-amber-600 text-white text-sm font-medium py-2.5"
                >
                  Draw this area on the map
                </button>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Figures are reported estimates.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Pick a recent event to draw its reported affected area on the map, then compare it
                  anywhere else. Newest events first — coverage depends on the AI's knowledge, so
                  the very latest events may be missing.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    ["any", "wildfire", "flood", "hurricane", "landslide", "earthquake"] as const
                  ).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setNewsType(t);
                        void loadNews(t);
                      }}
                      disabled={newsLoading}
                      className={`text-xs px-2.5 py-1 rounded-full capitalize disabled:opacity-50 ${
                        newsType === t
                          ? "bg-amber-600 text-white"
                          : "bg-secondary text-secondary-foreground hover:bg-accent"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto -mx-1 px-1">
                  {newsLoading && (
                    <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                      <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                      Searching the latest reports…
                    </div>
                  )}
                  {newsError && !newsLoading && (
                    <div className="py-4 text-xs text-destructive">{newsError}</div>
                  )}
                  {!newsLoading &&
                    newsEvents.map((e, i) => (
                      <div
                        key={`${e.title}-${i}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => pickDisaster(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" || ev.key === " ") pickDisaster(e);
                        }}
                        className="w-full text-left rounded-xl border border-black/5 hover:bg-accent px-3 py-2.5 mb-2 cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium line-clamp-2">{e.title}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {e.type}
                            </span>
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDetailEvent(e);
                              }}
                              aria-label={`More about ${e.title}`}
                              className="h-6 w-6 rounded-full border border-black/10 text-[11px] font-serif italic text-muted-foreground hover:bg-background"
                            >
                              i
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {e.place}
                          {e.country ? `, ${e.country}` : ""} · {e.date}
                        </div>
                        <div className="text-xs mt-1 font-medium text-amber-700">
                          {e.area_value.toLocaleString()} {e.area_unit} affected ·{" "}
                          {formatArea(eventAreaM2(e))}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{e.summary}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Reported estimate
                          {e.source && e.source !== "unknown" ? ` · ${e.source}` : ""}
                        </div>
                      </div>
                    ))}
                  {!newsLoading && !newsError && newsEvents.length === 0 && (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      Choose a category to load events.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

