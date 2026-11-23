// news-image-20261122 v6 — "THE SUNDAY GLOBE" magazine, krem klasik + serif.
// Renders a 1024x1024 front page for Sunday 22 November 2026 (36 stories + DATE CHECK).
// Pure Node 22, no network, deterministic. Text is rendered from real Liberation
// Serif TTF files (fonts/) with a hand-written TrueType parser + rasterizer.
// Writes one PNG to MAKEFUN_OUTPUT_DIR or /output/entry.png.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const W = 1024;
const H = 1024;

// ---------- palette (v5 klasik: krem kertas, tinta hitam, merah koran, emas) ----------
const CREAM = [246, 238, 216];
const CREAM2 = [251, 246, 232];
const PAPER = [243, 231, 199];
const INK = [20, 18, 16];
const RED = [163, 22, 33];
const RED_D = [140, 18, 28];
const GOLD = [201, 162, 39];
const GOLD_D = [176, 138, 46];
const TAN = [217, 192, 138];
const TAN_D = [196, 168, 108];
const SKY = [168, 196, 214];
const SKY_D = [120, 158, 182];
const NIGHT = [24, 34, 58];
const WHITE = [255, 255, 255];
const GREY = [90, 84, 74];

// ---------- CRC32 + PNG ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- canvas ----------
class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = bg[0]; this.buf[i * 3 + 1] = bg[1]; this.buf[i * 3 + 2] = bg[2];
    }
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  blend(x, y, c, a) { // a: 0..255 coverage
    if (a <= 0) return;
    if (a >= 255) { this.set(x, y, c); return; }
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    const inv = 255 - a;
    this.buf[i] = (c[0] * a + this.buf[i] * inv) / 255 | 0;
    this.buf[i + 1] = (c[1] * a + this.buf[i + 1] * inv) / 255 | 0;
    this.buf[i + 2] = (c[2] * a + this.buf[i + 2] * inv) / 255 | 0;
  }
  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  hline(x, y, w, c, th = 1) { this.rect(x, y - Math.floor(th / 2), w, th, c); }
  vline(x, y, h, c, th = 1) { this.rect(x - Math.floor(th / 2), y, th, h, c); }
  border(x, y, w, h, c, th = 1) {
    this.rect(x, y, w, th, c);
    this.rect(x, y + h - th, w, th, c);
    this.rect(x, y, th, h, c);
    this.rect(x + w - th, y, th, h, c);
  }
  // thick line via distance-to-segment sampling in its bbox
  line(x0, y0, x1, y1, c, th = 1) {
    const r = Math.ceil(th / 2) + 1;
    const minX = Math.floor(Math.min(x0, x1)) - r, maxX = Math.ceil(Math.max(x0, x1)) + r;
    const minY = Math.floor(Math.min(y0, y1)) - r, maxY = Math.ceil(Math.max(y0, y1)) + r;
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x0 + t * dx, py = y0 + t * dy;
        const d = Math.hypot(x - px, y - py);
        if (d <= th / 2) this.set(x, y, c);
      }
    }
  }
  circle(cx, cy, r, c, fill = true) {
    const rr = Math.ceil(r);
    for (let y = cy - rr; y <= cy + rr; y++)
      for (let x = cx - rr; x <= cx + rr; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (fill ? d <= r : d <= r && d >= r - 1) this.set(x, y, c);
      }
  }
  // scanline polygon fill, non-zero winding
  poly(pts, c) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]); x <= xs[i + 1]; x++) this.set(x, y, c);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) this.set(x, y, c);
      }
  }
  tri(x0, y0, x1, y1, x2, y2, c) { this.poly([[x0, y0], [x1, y1], [x2, y2]], c); }
}

// ---------- TrueType font: parser + quadratic-outline rasterizer ----------
class Font {
  constructor(file) {
    this.data = readFileSync(file);
    const d = this.data;
    const u16 = (o) => d.readUInt16BE(o);
    const u32 = (o) => d.readUInt32BE(o);
    const i16 = (o) => d.readInt16BE(o);
    this.u16 = u16; this.u32 = u32; this.i16 = i16;
    const numTables = u16(4);
    this.tables = {};
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      this.tables[d.toString("ascii", o, o + 4)] = { off: u32(o + 8), len: u32(o + 12) };
    }
    const head = this.tables.head.off;
    this.unitsPerEm = u16(head + 18);
    this.indexToLocFormat = i16(head + 50);
    const maxp = this.tables.maxp.off;
    this.numGlyphs = u16(maxp + 4);
    const hhea = this.tables.hhea.off;
    this.numHMetrics = u16(hhea + 34);
    this.ascent = i16(hhea + 4);
    this.descent = i16(hhea + 6);
    // cmap: prefer format 12, else format 4
    const cmap = this.tables.cmap.off;
    const nSub = u16(cmap + 2);
    this.cmap12 = null; this.cmap4 = null;
    for (let i = 0; i < nSub; i++) {
      const sub = cmap + u32(cmap + 4 + i * 8 + 4);
      const fmt = u16(sub);
      if (fmt === 12) this.cmap12 = sub;
      else if (fmt === 4) this.cmap4 = sub;
    }
    this.cache = new Map();
  }
  glyphIndex(cp) {
    const d = this.data, u16 = this.u16, u32 = this.u32, i16 = this.i16;
    if (this.cmap12 !== null) {
      const sub = this.cmap12;
      const n = u32(sub + 12);
      let lo = 0, hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const o = sub + 16 + mid * 12;
        const start = u32(o), end = u32(o + 4), base = u32(o + 8);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return base + (cp - start);
      }
      return 0;
    }
    const sub = this.cmap4;
    const segCount = u16(sub + 6) / 2;
    const endOff = sub + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    for (let i = 0; i < segCount; i++) {
      const end = u16(endOff + i * 2);
      if (cp <= end) {
        const start = u16(startOff + i * 2);
        if (cp < start) return 0;
        const delta = i16(deltaOff + i * 2);
        const ro = u16(rangeOff + i * 2);
        if (ro === 0) return (cp + delta) & 0xffff;
        const giOff = rangeOff + i * 2 + ro + (cp - start) * 2;
        const g = u16(giOff);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
    }
    return 0;
  }
  advance(gid) {
    const hmtx = this.tables.hmtx.off;
    const g = Math.min(gid, this.numHMetrics - 1);
    return this.u16(hmtx + g * 4);
  }
  glyphOffset(gid) {
    const loca = this.tables.loca.off;
    if (this.indexToLocFormat === 1) {
      return [this.u32(loca + gid * 4), this.u32(loca + (gid + 1) * 4)];
    }
    return [this.u16(loca + gid * 2) * 2, this.u16(loca + (gid + 1) * 2) * 2];
  }
  // returns array of contours; each contour = array of segments
  // segment: {x0,y0,x1,y1} line or {x0,y0,cx,cy,x1,y1} quadratic, font units
  glyphOutline(gid, depth = 0) {
    const glyf = this.tables.glyf.off;
    const [o0, o1] = this.glyphOffset(gid);
    if (o1 <= o0) return [];
    const d = this.data, u16 = this.u16, i16 = this.i16;
    const base = glyf + o0;
    const nContours = i16(base);
    if (nContours < 0) { // composite
      let p = base + 10;
      const out = [];
      for (;;) {
        const flags = u16(p); p += 2;
        const comp = u16(p); p += 2;
        let arg1, arg2;
        if (flags & 0x0001) { arg1 = i16(p); arg2 = i16(p + 2); p += 4; }
        else { arg1 = d[p]; arg2 = d[p + 1]; p += 2; }
        let a = 1, b = 0, c = 0, e = 1;
        if (flags & 0x0008) { a = i16(p) / 16384; e = a; p += 2; }
        else if (flags & 0x0040) { a = i16(p) / 16384; e = i16(p + 2) / 16384; p += 4; }
        else if (flags & 0x0080) {
          a = i16(p) / 16384; b = i16(p + 2) / 16384;
          c = i16(p + 4) / 16384; e = i16(p + 6) / 16384; p += 8;
        }
        let dx = 0, dy = 0;
        if (flags & 0x0002) { dx = arg1; dy = arg2; }
        if (depth < 4) {
          for (const contour of this.glyphOutline(comp, depth + 1)) {
            out.push(contour.map((s) => {
              const t = (x, y) => [x * a + y * c + dx, x * b + y * e + dy];
              if (s.cx === undefined) {
                const [nx0, ny0] = t(s.x0, s.y0);
                const [nx1, ny1] = t(s.x1, s.y1);
                return { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
              }
              const [nx0, ny0] = t(s.x0, s.y0);
              const [ncx, ncy] = t(s.cx, s.cy);
              const [nx1, ny1] = t(s.x1, s.y1);
              return { x0: nx0, y0: ny0, cx: ncx, cy: ncy, x1: nx1, y1: ny1 };
            }));
          }
        }
        if (!(flags & 0x0020)) break;
      }
      return out;
    }
    const endPtsOff = base + 10;
    const nPts = nContours === 0 ? 0 : u16(endPtsOff + (nContours - 1) * 2) + 1;
    const instrLenOff = endPtsOff + nContours * 2;
    const instrLen = u16(instrLenOff);
    let p = instrLenOff + 2 + instrLen;
    const flags = [];
    while (flags.length < nPts) {
      const f = d[p++];
      flags.push(f);
      if (f & 0x08) { const rep = d[p++]; for (let i = 0; i < rep; i++) flags.push(f); }
    }
    const xs = [], ys = [];
    let x = 0, y = 0;
    // TrueType stores ALL x deltas first, then ALL y deltas.
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x02) { const v = d[p++]; x += f & 0x10 ? v : -v; }
      else if (!(f & 0x10)) { x += i16(p); p += 2; }
      xs.push(x);
    }
    for (let i = 0; i < nPts; i++) {
      const f = flags[i];
      if (f & 0x04) { const v = d[p++]; y += f & 0x20 ? v : -v; }
      else if (!(f & 0x20)) { y += i16(p); p += 2; }
      ys.push(y);
    }
    const contours = [];
    let start = 0;
    for (let ci = 0; ci < nContours; ci++) {
      const end = u16(endPtsOff + ci * 2);
      const pts = [];
      for (let i = start; i <= end; i++)
        pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 0x01) });
      start = end + 1;
      contours.push(this.contourToSegments(pts));
    }
    return contours;
  }
  contourToSegments(pts) {
    // expand implied on-curve midpoints, then emit line/quadratic segments
    const exp = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % n];
      exp.push(cur);
      if (!cur.on && !nxt.on)
        exp.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, on: true });
    }
    // rotate so it starts on-curve
    let s = 0;
    while (s < exp.length && !exp[s].on) s++;
    const rot = s === 0 ? exp : exp.slice(s).concat(exp.slice(0, s));
    const segs = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i], b = rot[(i + 1) % rot.length];
      if (b.on) segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      else {
        const c = rot[(i + 2) % rot.length];
        segs.push({ x0: a.x, y0: a.y, cx: b.x, cy: b.y, x1: c.x, y1: c.y });
        i++;
      }
    }
    return segs;
  }
  // rasterize one glyph to a coverage bitmap (SS=4 supersampling), returns
  // {w,h,ox,oy,adv,buf} where buf is Uint8 0..255 coverage, origin at baseline
  raster(gid, px) {
    const key = gid + "@" + px;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const scale = px / this.unitsPerEm;
    const contours = this.glyphOutline(gid);
    // flatten to line segments in pixel space (y down, baseline y=0)
    const segs = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const contour of contours) {
      for (const s of contour) {
        if (s.cx === undefined) {
          segs.push([s.x0 * scale, -s.y0 * scale, s.x1 * scale, -s.y1 * scale]);
        } else {
          const steps = 14;
          let px0 = s.x0 * scale, py0 = -s.y0 * scale;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps, mt = 1 - t;
            const qx = (mt * mt * s.x0 + 2 * mt * t * s.cx + t * t * s.x1) * scale;
            const qy = -(mt * mt * s.y0 + 2 * mt * t * s.cy + t * t * s.y1) * scale;
            segs.push([px0, py0, qx, qy]);
            px0 = qx; py0 = qy;
          }
        }
      }
    }
    for (const [x0, y0, x1, y1] of segs) {
      minX = Math.min(minX, x0, x1); maxX = Math.max(maxX, x0, x1);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
    const adv = this.advance(gid) * scale;
    if (segs.length === 0 || !isFinite(minX)) {
      const r = { w: 0, h: 0, ox: 0, oy: 0, adv, buf: new Uint8Array(0) };
      this.cache.set(key, r); return r;
    }
    const ox = Math.floor(minX), oy = Math.floor(minY);
    const w = Math.ceil(maxX) - ox + 1, h = Math.ceil(maxY) - oy + 1;
    const buf = new Uint8Array(w * h);
    const SS = 4;
    for (let py = 0; py < h; py++) {
      for (let pxp = 0; pxp < w; pxp++) {
        let inside = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const X = ox + pxp + (sx + 0.5) / SS;
            const Y = oy + py + (sy + 0.5) / SS;
            let wind = 0;
            for (const [x0, y0, x1, y1] of segs) {
              if ((y0 <= Y && y1 > Y) || (y1 <= Y && y0 > Y)) {
                const xi = x0 + (Y - y0) * (x1 - x0) / (y1 - y0);
                if (X < xi) wind += y1 > y0 ? 1 : -1;
              }
            }
            if (wind !== 0) inside++;
          }
        }
        buf[py * w + pxp] = (inside * 255) / (SS * SS) | 0;
      }
    }
    const r = { w, h, ox, oy, adv, buf };
    this.cache.set(key, r);
    return r;
  }
  widthOf(text, px) {
    let w = 0;
    for (const ch of text) w += this.raster(this.glyphIndex(ch.codePointAt(0)), px).adv;
    return w;
  }
}

// ---------- text drawing ----------
let REG, BOLD, ITAL;
function loadFonts() {
  REG = new Font(join(DIR, "fonts", "LiberationSerif-Regular.ttf"));
  BOLD = new Font(join(DIR, "fonts", "LiberationSerif-Bold.ttf"));
  ITAL = new Font(join(DIR, "fonts", "LiberationSerif-Italic.ttf"));
}
function drawText(cv, font, text, x, baselineY, px, color, tracking = 0) {
  let cx = x;
  for (const ch of text) {
    const gid = font.glyphIndex(ch.codePointAt(0));
    const g = font.raster(gid, px);
    for (let py = 0; py < g.h; py++) {
      for (let pxx = 0; pxx < g.w; pxx++) {
        const a = g.buf[py * g.w + pxx];
        if (a) cv.blend(Math.round(cx) + g.ox + pxx, Math.round(baselineY) + g.oy + py, color, a);
      }
    }
    cx += g.adv + tracking;
  }
  return cx;
}
function textWidth(font, text, px, tracking = 0) {
  return font.widthOf(text, px) + tracking * Math.max(0, [...text].length - 1);
}
function wrapText(font, text, px, maxW) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (font.widthOf(t, px) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawWrapped(cv, font, text, x, y, px, maxW, color, lh) {
  const lines = wrapText(font, text, px, maxW);
  let yy = y;
  for (const ln of lines) { drawText(cv, font, ln, x, yy, px, color); yy += lh; }
  return yy;
}
// shrink font until text fits maxW (returns size used)
function fitText(cv, font, text, x, baselineY, px, maxW, color, tracking = 0) {
  let s = px;
  while (s > 7 && textWidth(font, text, s, tracking) > maxW) s -= 0.5;
  drawText(cv, font, text, x, baselineY, s, color, tracking);
  return s;
}

// ---------- world map (equirectangular, stylised continents) ----------
// lon/lat pairs; Africa east coast bulged slightly so Mogadishu (45.6, 2.0) sits on land.
const CONTINENTS = [
  { name: "NA", pts: [[-168,66],[-158,58],[-152,60],[-140,60],[-135,58],[-130,54],[-125,49],[-124,42],[-120,34],[-114,29],[-110,24],[-105,20],[-97,16],[-92,15],[-86,12],[-83,9],[-80,8],[-77,7],[-79,9],[-84,13],[-90,14],[-92,15],[-97,16],[-96,19],[-90,21],[-87,21],[-86,16],[-83,17],[-80,23],[-81,25],[-80,27],[-81,31],[-76,35],[-74,40],[-70,42],[-68,44],[-65,45],[-60,47],[-55,47],[-59,50],[-55,52],[-60,55],[-65,58],[-68,55],[-72,58],[-78,62],[-85,66],[-92,66],[-95,69],[-110,68],[-125,70],[-140,70],[-155,71],[-165,68]] },
  { name: "GL", pts: [[-58,64],[-52,60],[-43,60],[-32,68],[-25,70],[-30,74],[-40,76],[-55,76],[-58,74],[-60,70]] },
  { name: "SA", pts: [[-79,9],[-77,4],[-80,-3],[-81,-6],[-77,-12],[-72,-18],[-70,-23],[-70,-30],[-72,-37],[-73,-44],[-74,-50],[-70,-54],[-66,-55],[-65,-48],[-62,-41],[-58,-34],[-52,-32],[-48,-27],[-41,-23],[-39,-17],[-35,-9],[-35,-6],[-40,-3],[-44,-2],[-50,0],[-53,4],[-58,6],[-62,9],[-68,11],[-72,12],[-76,10]] },
  { name: "EU", pts: [[-10,36],[-9,38],[-9,43],[-2,44],[-1,46],[-4,48],[-2,50],[0,51],[3,53],[5,53],[8,55],[8,57],[10,59],[12,56],[18,56],[21,55],[21,57],[24,59],[28,60],[25,62],[23,65],[25,70],[30,70],[35,68],[40,66],[44,64],[40,60],[38,58],[35,55],[33,52],[30,48],[28,46],[28,44],[23,40],[22,37],[19,40],[16,38],[12,42],[8,44],[6,43],[3,42],[0,39],[-2,37],[-6,36]] },
  { name: "AF", pts: [[-17,15],[-16,20],[-14,24],[-11,28],[-9,31],[-6,34],[-1,35],[3,37],[9,37],[11,34],[15,32],[19,32],[23,33],[25,32],[30,31],[32,31],[34,28],[35,28],[37,24],[38,20],[39,16],[40,15],[43,12],[46,11],[51,11],[51,10],[48,7],[46.5,2],[44,0],[41,-2],[40,-6],[40,-10],[38,-15],[36,-18],[34,-22],[33,-26],[31,-29],[28,-33],[25,-34],[20,-35],[17,-33],[15,-27],[13,-22],[12,-17],[12,-12],[11,-6],[9,-1],[9,4],[7,4],[3,6],[-2,5],[-8,5],[-12,8],[-15,11],[-17,13]] },
  { name: "AS", pts: [[30,70],[35,68],[40,66],[44,64],[48,66],[52,68],[58,69],[65,70],[70,72],[75,73],[80,73],[85,74],[90,75],[95,76],[100,77],[105,77],[110,74],[115,73],[120,73],[125,72],[130,72],[135,71],[140,72],[145,72],[150,70],[155,69],[160,69],[165,66],[170,66],[178,65],[178,64],[170,60],[162,60],[158,56],[156,52],[150,59],[142,55],[142,50],[140,45],[138,40],[135,35],[130,33],[127,35],[127,39],[130,42],[132,43],[135,44],[138,46],[140,40],[141,38],[139,35],[137,34],[133,34],[130,32],[127,31],[124,28],[121,25],[119,24],[116,23],[112,22],[108,18],[105,16],[103,10],[101,8],[100,7],[98,10],[97,15],[94,17],[92,21],[90,22],[88,22],[86,20],[84,19],[82,17],[80,15],[80,13],[79,9],[77,8],[76,10],[74,14],[73,18],[71,21],[69,22],[66,25],[64,25],[61,25],[59,26],[57,27],[55,27],[53,27],[51,28],[50,29],[49,30],[48,30],[47,29],[46,29],[44,29],[43,30],[42,32],[41,33],[40,35],[39,36],[37,36],[35,36],[33,36],[31,36],[30,36],[29,36],[28,36],[27,37],[26,38],[24,38],[23,36],[26,39],[28,41],[30,43],[31,45],[32,48],[33,52],[35,55],[38,58],[40,60],[38,60],[35,62],[33,65],[30,68]] },
  { name: "SEA", pts: [[95,16],[97,12],[99,9],[100,6],[101,3],[103,2],[104,2],[103,5],[101,8],[100,12],[99,14]] },
  { name: "ID", pts: [[95,5],[98,3],[101,0],[104,-2],[107,-4],[110,-6],[113,-7],[116,-8],[119,-8],[121,-9],[120,-10],[117,-10],[114,-9],[111,-7],[108,-6],[105,-4],[102,-2],[99,2],[96,4]] },
  { name: "JP", pts: [[130,31],[132,33],[134,34],[136,35],[138,35],[140,36],[141,38],[141,40],[141,42],[143,43],[145,44],[144,42],[142,40],[140,37],[138,36],[136,34],[133,33],[131,32]] },
  { name: "UK", pts: [[-5,50],[-3,50],[-1,51],[0,52],[1,53],[0,55],[-2,57],[-4,58],[-6,57],[-7,55],[-6,53],[-5,51]] },
  { name: "AU", pts: [[113,-22],[114,-28],[115,-33],[118,-35],[122,-34],[126,-32],[129,-32],[132,-32],[135,-35],[137,-35],[139,-37],[141,-38],[145,-38],[148,-38],[150,-37],[151,-34],[153,-32],[153,-27],[152,-24],[150,-22],[148,-20],[146,-19],[144,-15],[142,-11],[141,-13],[139,-15],[137,-12],[135,-12],[132,-12],[130,-13],[127,-14],[124,-15],[121,-17],[118,-20],[115,-21]] },
  { name: "NZ", pts: [[167,-45],[169,-43],[171,-41],[173,-40],[175,-38],[177,-38],[178,-37],[176,-40],[174,-41],[172,-43],[169,-46],[167,-46]] },
];
// pin lon/lat: 1 Antalya 2 Gulf of Finland 3 Peru 4 Jerusalem 5 Kryvyi Rih
// 6 Sinaloa 7 Bahrain 8 Mogadishu 9 Gaza 10 USA 11 Las Vegas 12 Twickenham 13 Newcastle
const PINS = [
  [30.7, 36.9], [27.0, 59.8], [-76.0, -10.0], [35.2, 31.8], [33.4, 47.9],
  [-106.5, 24.5], [50.6, 26.2], [45.6, 2.0], [34.5, 31.5], [-115.1, 36.2],
  [-115.14, 36.17], [-0.9, 51.1], [-1.6, 55.0],
];
function project(lon, lat, box) {
  const x = box.x + ((lon + 168) / 352) * box.w;
  const y = box.y + ((76 - lat) / 132) * box.h;
  return [x, y];
}

// ---------- lead illustrations (code-drawn, clean lines) ----------
function illuCOP31(cv, x, y, w, h) {
  cv.rect(x, y, w, h, SKY);
  // globe
  const gx = x + 52, gy = y + 52, gr = 34;
  cv.circle(gx, gy, gr, [52, 110, 160]);
  cv.circle(gx, gy, gr, INK); // outline pass below via ring
  cv.circle(gx, gy, gr - 1, [52, 110, 160]);
  cv.ellipse(gx - 12, gy - 8, 13, 8, [74, 160, 110]);
  cv.ellipse(gx + 12, gy + 12, 11, 7, [74, 160, 110]);
  cv.ellipse(gx + 8, gy - 16, 7, 5, [74, 160, 110]);
  cv.circle(gx, gy, gr, INK, false);
  // flag row: small pennants
  const cols = [[163, 22, 33], [201, 162, 39], [47, 110, 160], [46, 125, 91], [122, 74, 138]];
  for (let i = 0; i < 5; i++) {
    const fx = x + 108 + i * 36;
    cv.vline(fx, y + 18, 52, INK, 2);
    cv.tri(fx, y + 18, fx + 26, y + 26, fx, y + 34, cols[i]);
  }
  // clock
  const cx = x + w - 46, cy = y + 44;
  cv.circle(cx, cy, 26, CREAM2);
  cv.circle(cx, cy, 26, INK, false);
  cv.circle(cx, cy, 2, INK);
  cv.line(cx, cy, cx, cy - 17, INK, 2);
  cv.line(cx, cy, cx + 12, cy + 6, INK, 2);
  // banner
  cv.rect(x + 96, y + 12, 118, 20, [46, 125, 91]);
  drawText(cv, BOLD, "DEAL IN SIGHT", x + 104, y + 27, 12, CREAM2);
  // bottom strip
  cv.rect(x, y + h - 18, w, 18, [46, 125, 91]);
  drawText(cv, BOLD, "VOTE: 06:00 GMT SUN", x + 8, y + h - 5, 11, CREAM2);
}
function illuShip(cv, x, y, w, h) {
  cv.rect(x, y, w, h, NIGHT);
  // smoke
  cv.circle(x + 70, y + 26, 12, [120, 120, 125]);
  cv.circle(x + 150, y + 20, 14, [120, 120, 125]);
  cv.circle(x + 235, y + 28, 11, [120, 120, 125]);
  // sea
  cv.rect(x, y + h - 26, w, 26, [28, 60, 96]);
  cv.hline(x + 10, y + h - 18, 60, SKY_D, 2);
  cv.hline(x + 200, y + h - 12, 80, SKY_D, 2);
  // hull
  cv.poly([[x + 12, y + h - 26], [x + w - 12, y + h - 26], [x + w - 34, y + h - 8], [x + 34, y + h - 8]], [140, 30, 32]);
  // containers
  const cc = [[201, 162, 39], [46, 125, 91], [47, 110, 160], [140, 60, 30], [122, 74, 138]];
  for (let i = 0; i < 5; i++) {
    cv.rect(x + 30 + i * 52, y + h - 62, 44, 36, cc[i]);
    cv.border(x + 30 + i * 52, y + h - 62, 44, 36, INK, 1);
  }
  // flames
  for (let i = 0; i < 5; i++) {
    const fx = x + 48 + i * 52;
    cv.tri(fx - 12, y + h - 62, fx, y + h - 96, fx + 12, y + h - 62, [240, 120, 20]);
    cv.tri(fx - 6, y + h - 62, fx, y + h - 82, fx + 6, y + h - 62, [250, 200, 60]);
  }
  // label
  cv.rect(x + w / 2 - 74, y + h - 16, 148, 14, INK);
  drawText(cv, BOLD, "SPARTA II ABLAZE", x + w / 2 - 66, y + h - 5, 10, CREAM2);
}
function illuQuake(cv, x, y, w, h) {
  cv.rect(x, y, w, h, [232, 214, 178]);
  // mountains
  cv.poly([[x, y + h], [x + 90, y + 18], [x + 180, y + h]], [122, 96, 66]);
  cv.poly([[x + 120, y + h], [x + 230, y + 8], [x + w, y + h]], [96, 74, 50]);
  // snow caps
  cv.tri(x + 78, y + 30, x + 90, y + 18, x + 102, y + 30, CREAM2);
  cv.tri(x + 216, y + 22, x + 230, y + 8, x + 244, y + 22, CREAM2);
  // seismograph strip
  const sx = x + w - 132, sy = y + 12;
  cv.rect(sx, sy, 120, 34, CREAM2);
  cv.border(sx, sy, 120, 34, INK, 1);
  const pts = [];
  const zz = [0, -8, 10, -14, 6, -4, 12, -16, 4, -6, 2, 0];
  for (let i = 0; i < zz.length; i++) pts.push([sx + 6 + i * 10, sy + 17 + zz[i]]);
  for (let i = 0; i + 1 < pts.length; i++)
    cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED, 2);
  // magnitude chip
  cv.rect(x + w - 64, y + h - 30, 56, 22, INK);
  drawText(cv, BOLD, "M 6.8", x + w - 56, y + h - 14, 14, CREAM2);
}

// ---------- content (brief-v1, unchanged) ----------
const LEADS = [
  {
    n: 1, kicker: "ANTALYA, TURKEY — CLIMATE",
    head: "COP31 CLIMATE TALKS CLOSE IN ON A FINAL DEAL",
    body: "A new package was announced at a late-night plenary; objections were due by 03:00 GMT and approval is set for Sunday morning. Fossil fuels and finance remain the sticking points. (Reuters)",
    illu: illuCOP31,
  },
  {
    n: 2, kicker: "GULF OF FINLAND — WAR AT SEA",
    head: "RUSSIAN CARGO SHIP ABLAZE AFTER DRONE STRIKE",
    body: "The sanctioned Sparta II, linked to Russia's Defence Ministry, was hit by suspected Ukrainian drones. The fire burned out of control overnight and may burn for days. (AP, Finnish Border Guard)",
    illu: illuShip,
  },
  {
    n: 3, kicker: "PERU — EARTHQUAKE",
    head: "MAGNITUDE 6.8 QUAKE SHAKES PERU'S ANDES",
    body: "The tremor sent people in Lima fleeing from their homes. First reports brought no word of damage or casualties. (Wire reports)",
    illu: illuQuake,
  },
];
const REST = [
  { n: 4, place: "JERUSALEM", head: "EISENKOT TO FORM NEW GOVERNMENT", body: "Herzog passes over Netanyahu; mandate ceremony is Sunday." },
  { n: 5, place: "UKRAINE", head: "KRYVYI RIH HIT: 2 DEAD, 60 HURT", body: "Kryvyi Rih: 60 wounded, a hospital and 25 blocks hit. (AP)" },
  { n: 6, place: "MEXICO", head: "CARTEL BOSS CAPTURED, 11 KILLED", body: "\u201CEl Chapo Isidro\u201D Meza Flores seized in Sinaloa. (France 24)" },
  { n: 7, place: "GULF", head: "BAHRAIN PLANT BURNS AFTER ATTACK", body: "Tehran seeks diplomacy; Trump rejects its terms." },
  { n: 8, place: "SOMALIA", head: "SOMALIA ORDERS UAE ENVOY TO LEAVE", body: "Mogadishu recalls its own ambassador too." },
  { n: 9, place: "GAZA", head: "FOUR NATIONS PRESS ISRAEL ON AID", body: "Australia, Canada, Italy, UK cite flood misery in Gaza." },
  { n: 10, place: "US", head: "COURT BACKS $7.25BN SETTLEMENT", body: "The deal resolves weedkiller cancer claims." },
  { n: 11, place: "LAS VEGAS", head: "VERSTAPPEN ON POLE AFTER PENALTY", body: "Antonelli was fastest but drops five places." },
  { n: 12, place: "RUGBY", head: "ENGLAND THRASH ALL BLACKS 37-12", body: "A record margin of victory for England. (BBC)" },
  { n: 13, place: "FOOTBALL", head: "LEEDS STUN CHELSEA 4-1", body: "Arsenal held 2-2; Madueke rescues a point at Newcastle." },
];
const WIRES = [
  [14, "Estonia: to close its Russia border; Moscow cries \u201CIron Curtain\u201D."],
  [15, "France: police jailed for racist violence, a landmark ruling."],
  [16, "France: 6th straight Saturday of cost-of-living protests."],
  [17, "US: Trump warns of a \u201Ctremendous tax\u201D on AI centres abroad."],
  [18, "US: man convicted of starting the deadly 2025 Palisades fire."],
  [19, "US: State Dept details $12bn of Venezuelan oil revenue."],
  [20, "US: Trump ousts cyber director after outage criticism."],
  [21, "Ebola: the death toll passes 5,700, containment goes on."],
  [22, "Myanmar: France seeks UN action on the genocide ruling."],
  [23, "India-China: commanders meet on the Arunachal frontier."],
  [24, "Bangladesh: 30 homes of Awami League members set on fire."],
  [25, "Thailand: heavy rain due in 6 provinces on Sunday (Met Dept)."],
  [26, "Japan: forces to train live-fire at Indian facilities, a first."],
  [27, "India: Air India extends Jeddah suspension to 24 Nov."],
  [28, "India: ICMR signs off 100 health technology transfers."],
  [29, "Cricket: Rahul's century headlines India's Test in NZ."],
  [30, "Cricket: Cummins wins unanimous backing as Australia captain."],
  [31, "Switzerland: 4,000-year-old bronze ring found in melting ice."],
  [32, "Canada: drones sample whale breath, whole genomes sequenced."],
  [33, "Australia: bystanders pull a driver from a burning car, Canberra."],
  [34, "Tasmania: dead man linked to a police officer's shooting."],
  [35, "Business: Leapmotor profit falls 73% despite record sales."],
  [36, "Football: PSG win 3-2 at Nice; Doue hurt badly."],
];
const DATECHECK = "WIRES AS OF ABOUT 00:20 UTC, SUNDAY 22 NOVEMBER 2026. LEFT OUT AS SATURDAY 21 NOVEMBER NEWS: THE KYIV BRIDGE STRIKES, THE SHENZHEN SUMMIT AND INDIA'S NITISH SETU OPENING. STILL TO COME AT PRESS TIME: COP31'S VOTE.";
const REGIONS = [
  ["N. AMERICA 8", [31, 78, 121]], ["EUROPE 10", [46, 125, 91]],
  ["MIDDLE EAST 3", [163, 22, 33]], ["ASIA 8", [47, 111, 111]],
  ["AFRICA 2", [138, 109, 31]], ["S. AMERICA 1", [122, 74, 138]],
  ["OCEANIA 4", [196, 106, 27]],
];

// ---------- layout ----------
function drawPin(cv, x, y, n, dx = 0, dy = 0) {
  if (dx || dy) cv.line(x, y, x + dx, y + dy, RED, 1);
  const cx = x + dx, cy = y + dy;
  cv.circle(cx, cy, 10, CREAM2);
  cv.circle(cx, cy, 9, RED);
  const s = String(n);
  const w = textWidth(BOLD, s, 10);
  drawText(cv, BOLD, s, cx - w / 2, cy + 3.5, 10, CREAM2);
}
// manual offsets (px) for pins whose true positions collide at this scale
// 11 Las Vegas shares 10's true point: disc sits NE in the US interior (lon ~-97.5,
// lat 50) with a leader back to Nevada; 7 Bahrain is nudged NE so pin 9 no longer
// covers its number.
const PIN_OFF = { 4: [-12, 10], 5: [8, 4], 7: [12, -10], 8: [-9, -2], 9: [16, 14], 11: [24, -14], 12: [14, 12] };
function build() {
  loadFonts();
  const cv = new Canvas(W, H, CREAM);
  const M = 24, CW = W - 2 * M; // content width 976

  // top micro-line
  drawText(cv, BOLD, "ONE DAY — ONE PAGE", M, 22, 11, RED);
  const tr = "EARLY EDITION — WIRES AS OF 00:20 UTC";
  drawText(cv, BOLD, tr, W - M - textWidth(BOLD, tr, 11), 22, 11, RED);
  cv.hline(M, 30, CW, INK, 2);

  // masthead (v3 structure: THE SUNDAY GLOBE dominant)
  const mast = "THE SUNDAY GLOBE";
  const mastW = textWidth(BOLD, mast, 56, 2);
  drawText(cv, BOLD, mast, (W - mastW) / 2, 80, 56, INK, 2);
  const date = "SUNDAY 22 NOVEMBER 2026";
  const dateW = textWidth(BOLD, date, 21, 1);
  drawText(cv, BOLD, date, (W - dateW) / 2, 104, 21, RED, 1);
  const tag = "COP31 nears a climate deal in Antalya — Russian ship ablaze in the Baltic — Earthquake shakes Peru";
  const tagW = textWidth(ITAL, tag, 15);
  drawText(cv, ITAL, tag, (W - tagW) / 2, 122, 15, INK);

  // stats strip (gold band)
  const sy = 132, sh = 22;
  cv.rect(M, sy, CW, sh, GOLD);
  drawText(cv, BOLD, "36 STORIES  •  7 REGIONS  •  13 PINS  •  6 SOURCES", M + 10, sy + 16, 14, INK);
  const sw = "WIRES AS OF 00:20 UTC";
  drawText(cv, BOLD, sw, W - M - 10 - textWidth(BOLD, sw, 13), sy + 16, 13, INK);

  // region bar
  const ry = 158, rh = 18, segW = CW / REGIONS.length;
  REGIONS.forEach(([label, col], i) => {
    const x = M + i * segW;
    cv.rect(x, ry, segW - 1, rh, col);
    const lw = textWidth(BOLD, label, 10.5);
    drawText(cv, BOLD, label, x + (segW - lw) / 2, ry + 14, 10.5, CREAM2);
  });

  // 3 lead panels
  const ly = 184, lh = 250, pw = 318, gap = 11;
  LEADS.forEach((lead, i) => {
    const x = M + i * (pw + gap);
    cv.border(x, ly, pw, lh, INK, 2);
    lead.illu(cv, x + 2, ly + 2, pw - 4, 104);
    // kicker
    const kick = lead.n + "  " + lead.kicker;
    drawText(cv, BOLD, kick, x + 10, ly + 124, 11.5, RED);
    // headline (19px, <=3 lines)
    const lines = wrapText(BOLD, lead.head, 19, pw - 20);
    let hy = ly + 146;
    for (const ln of lines) { drawText(cv, BOLD, ln, x + 10, hy, 19, INK); hy += 21; }
    // body (11px, fits inside panel)
    drawWrapped(cv, REG, lead.body, x + 10, hy + 4, 11, pw - 20, INK, 12.5);
  });

  // map row
  const my = 442, mh = 236;
  const mapX = M, mapW = 500;
  cv.border(mapX, my, mapW, mh, INK, 2);
  cv.rect(mapX + 2, my + 2, mapW - 4, mh - 4, PAPER);
  drawText(cv, BOLD, "WORLD MAP — 13 PINS", mapX + 10, my + 18, 12, RED);
  const box = { x: mapX + 8, y: my + 26, w: mapW - 16, h: 132 };
  // sea
  cv.rect(box.x, box.y, box.w, box.h, CREAM2);
  for (const c of CONTINENTS) {
    const pts = c.pts.map(([lo, la]) => project(lo, la, box));
    cv.poly(pts, TAN);
  }
  // graticule
  for (let lo = -150; lo <= 150; lo += 30) {
    const [x0] = project(lo, 76, box);
    cv.vline(x0, box.y, box.h, [210, 196, 160], 1);
  }
  // pin 11 (Las Vegas) shares pin 10's true point: draw its leader BEFORE pin 10
  // so the line starts underneath pin 10's disc and never strikes through the "10".
  {
    const [lvx, lvy] = project(PINS[10][0], PINS[10][1], box);
    const o11 = PIN_OFF[11];
    cv.line(Math.round(lvx), Math.round(lvy), Math.round(lvx) + o11[0], Math.round(lvy) + o11[1], RED, 1);
  }
  PINS.forEach(([lo, la], idx) => {
    const [px, py] = project(lo, la, box);
    const off = PIN_OFF[idx + 1] || [0, 0];
    // pin 11: leader already drawn above; draw the disc only, at its offset spot.
    if (idx + 1 === 11) drawPin(cv, Math.round(px) + off[0], Math.round(py) + off[1], 11);
    else drawPin(cv, Math.round(px), Math.round(py), idx + 1, off[0], off[1]);
  });
  // map legend
  const leg1 = "1 ANTALYA   2 GULF OF FINLAND   3 PERU   4 JERUSALEM   5 KRYVYI RIH   6 SINALOA";
  const leg2 = "7 BAHRAIN   8 MOGADISHU   9 GAZA   10 USA   11 LAS VEGAS   12 TWICKENHAM   13 NEWCASTLE";
  drawText(cv, BOLD, leg1, mapX + 10, my + 190, 9.5, INK);
  drawText(cv, BOLD, leg2, mapX + 10, my + 202, 9.5, INK);

  // right column: stories 4–13
  const rx = mapX + mapW + 14, rw = W - M - rx;
  drawText(cv, BOLD, "THE REST OF THE DAY — STORIES 4–13", rx, my + 15, 13, RED);
  cv.hline(rx, my + 21, rw, GOLD, 2);
  let yy = my + 34;
  for (const s of REST) {
    // numbered red disc
    cv.circle(rx + 9, yy - 4, 9, RED);
    const ns = String(s.n);
    drawText(cv, BOLD, ns, rx + 9 - textWidth(BOLD, ns, 10) / 2, yy, 10, CREAM2);
    const hx = rx + 24;
    fitText(cv, BOLD, s.head, hx, yy, 12, rw - 24, INK);
    yy += 10;
    fitText(cv, REG, s.body, hx, yy, 9.5, rw - 24, GREY);
    yy += 11;
  }

  // wires section
  const wy = 686;
  drawText(cv, BOLD, "ALSO IN SUNDAY'S EARLY WIRES — 23 MORE STORIES", M, wy + 12, 14, INK);
  cv.hline(M, wy + 18, CW, GOLD, 2);
  const colW = (CW - 24) / 2;
  const left = WIRES.slice(0, 12), right = WIRES.slice(12);
  const drawWireCol = (items, x0) => {
    let y0 = wy + 40;
    for (const [n, t] of items) {
      drawText(cv, BOLD, String(n), x0, y0, 11, RED);
      const tw = textWidth(BOLD, String(n), 11);
      fitText(cv, REG, t, x0 + tw + 6, y0, 11, colW - tw - 8, INK);
      y0 += 17.5;
    }
  };
  drawWireCol(left, M);
  drawWireCol(right, M + colW + 24);

  // DATE CHECK
  const dy = 930, dh = 56;
  cv.rect(M, dy, CW, dh, [241, 223, 172]);
  cv.border(M, dy, CW, dh, RED, 2);
  drawText(cv, BOLD, "DATE CHECK — EARLY EDITION:", M + 10, dy + 18, 13, RED);
  const dcLines = wrapText(REG, DATECHECK, 12.5, CW - 20);
  let dyy = dy + 36;
  for (const ln of dcLines) { drawText(cv, REG, ln, M + 10, dyy, 12.5, INK); dyy += 15; }

  // sources + footer
  const syy = 996;
  drawText(cv, BOLD, "SOURCES: REUTERS — AP — BBC — FRANCE 24 — FINNISH BORDER GUARD — WIRE REPORTS", M, syy, 10, INK);
  drawText(cv, BOLD, "ORIGINAL DRAWINGS", W - M - textWidth(BOLD, "ORIGINAL DRAWINGS", 10), syy, 10, INK);
  const foot = "Every story here happened, or was first reported, on Sunday 22 November 2026 (UTC), or carries a fresh overnight development.";
  drawText(cv, ITAL, foot, M, syy + 14, 10, GREY);
  return encodePNG(cv.buf, W, H);
}

function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const png = build();
  writeFileSync(join(outDir, "entry.png"), png);
}
main();
