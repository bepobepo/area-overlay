export type ShareCardInfo = {
  heading?: string; // e.g. "Flood · 28 Aug 2026"
  subheading?: string; // e.g. country
  summary?: string;
  people?: string;
  source?: string;
};

export type ShareCardInput = {
  mapCanvas: HTMLCanvasElement;
  label: string;
  areaText: string;
  comparison: string;
  place: string;
  info?: ShareCardInfo | null;
  footer: string;
};

const W = 1080;
const H = 1350;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const pad = 56;

  // Background
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#22d3ee";
  ctx.font = font(800, 26);
  ctx.fillText("SHAPE SWAP", pad, 76);
  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 52);
  const titleLines = wrap(ctx, input.label, W - pad * 2, 2);
  let y = 140;
  for (const l of titleLines) {
    ctx.fillText(l, pad, y);
    y += 60;
  }
  ctx.fillStyle = "#cbd5e1";
  ctx.font = font(600, 30);
  ctx.fillText(`${input.areaText}  ·  ${input.comparison}`, pad, y);
  y += 34;

  // Map snapshot (cover-fit)
  const hasInfo = !!input.info;
  const mapTop = y + 10;
  const mapH = hasInfo ? 640 : 860;
  const mapW = W - pad * 2;
  const src = input.mapCanvas;
  const scale = Math.max(mapW / src.width, mapH / src.height);
  const sw = mapW / scale;
  const sh = mapH / scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(pad, mapTop, mapW, mapH, 28);
  ctx.clip();
  ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, pad, mapTop, mapW, mapH);
  ctx.restore();

  // Compared with
  y = mapTop + mapH + 60;
  ctx.fillStyle = "#94a3b8";
  ctx.font = font(600, 26);
  ctx.fillText("COMPARED WITH", pad, y);
  ctx.fillStyle = "#f472b6";
  ctx.font = font(800, 38);
  ctx.fillText(wrap(ctx, input.place || "a new place", W - pad * 2, 1)[0] ?? "", pad, y + 46);
  y += 100;

  if (input.info) {
    const i = input.info;
    ctx.fillStyle = "#ffffff";
    ctx.font = font(700, 30);
    if (i.heading) {
      ctx.fillText(wrap(ctx, i.heading + (i.subheading ? ` · ${i.subheading}` : ""), W - pad * 2, 1)[0], pad, y);
      y += 42;
    }
    if (i.summary) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = font(400, 26);
      for (const l of wrap(ctx, i.summary, W - pad * 2, 3)) {
        ctx.fillText(l, pad, y);
        y += 34;
      }
      y += 6;
    }
    if (i.people) {
      ctx.fillStyle = "#fbbf24";
      ctx.font = font(700, 28);
      ctx.fillText(wrap(ctx, `People affected: ${i.people}`, W - pad * 2, 1)[0], pad, y);
      y += 40;
    }
    if (i.source) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = font(500, 22);
      ctx.fillText(wrap(ctx, `Source: ${i.source}`, W - pad * 2, 1)[0], pad, y);
    }
  }

  // Footer
  ctx.fillStyle = "#22d3ee";
  ctx.font = font(600, 24);
  ctx.textAlign = "right";
  ctx.fillText(input.footer, W - pad, H - 36);

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("export failed"))), "image/png"));
}
