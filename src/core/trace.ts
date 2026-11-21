/**
 * 位图描摹:导入字形图 → 灰度阈值 → 轮廓追踪(marching squares)→ 矢量多边形。
 * 输出 100×100 em 框坐标,直接当篆字用。
 */
import { Pt } from './geom';
import { MultiPoly, Ring } from './polygon';

/** 从 ImageData 提取二值网格(深色为墨迹) */
function toGrid(img: ImageData, threshold: number): { g: Uint8Array; w: number; h: number } {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const gg = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const lum = (r * 299 + gg * 587 + b * 114) / 1000;
    g[i] = a > 40 && lum < threshold ? 1 : 0;
  }
  return { g, w, h };
}

/**
 * marching squares 轮廓追踪。返回像素坐标环集合。
 * 实现:对每个 2×2 单元生成边界线段,再把线段首尾接成环。
 */
export function traceImage(img: ImageData, threshold = 140): MultiPoly {
  const { g, w, h } = toGrid(img, threshold);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? g[y * w + x] : 0);

  // 边界线段:key 用 "x,y" 顶点编码(顶点在像素角点上,坐标 0..w)
  const segs = new Map<string, [string, string]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const a = key(x1, y1);
    const b = key(x2, y2);
    segs.set(`${a}|${b}`, [a, b]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      // 实心像素的四条边,若邻像素为空则是边界(顶点取像素角)
      if (!at(x, y - 1)) addSeg(x, y, x + 1, y); // 上边
      if (!at(x + 1, y)) addSeg(x + 1, y, x + 1, y + 1); // 右边
      if (!at(x, y + 1)) addSeg(x + 1, y + 1, x, y + 1); // 下边
      if (!at(x - 1, y)) addSeg(x, y + 1, x, y); // 左边
    }
  }

  // 接链成环
  const fromMap = new Map<string, string[]>();
  for (const [a, b] of segs.values()) {
    if (!fromMap.has(a)) fromMap.set(a, []);
    fromMap.get(a)!.push(b);
  }

  const rings: Ring[] = [];
  const used = new Set<string>();
  for (const [edgeKey, [a, b]] of segs) {
    if (used.has(edgeKey)) continue;
    const ring: Ring = [];
    let cur = a;
    let next = b;
    used.add(edgeKey);
    const parse = (k: string): Pt => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    };
    ring.push(parse(cur));
    let guard = 0;
    while (guard++ < 100000) {
      ring.push(parse(next));
      if (next === a) break;
      const outs = (fromMap.get(next) ?? []).filter((o) => !used.has(`${next}|${o}`));
      if (outs.length === 0) break;
      const nxt = outs[0];
      used.add(`${next}|${nxt}`);
      next = nxt;
    }
    if (ring.length >= 4) {
      ring.pop(); // 末点与首点重复
      rings.push(ring);
    }
  }

  if (rings.length === 0) return [];

  // 归一化到 100em 框(保持纵横比,留 5% 边距)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings)
    for (const p of r) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 90 / span;
  const ox = (100 - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (100 - (maxY - minY) * scale) / 2 - minY * scale;
  const norm = rings.map((r) => r.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy })));

  // 按面积嵌套:外环 / 孔环
  const area = (r: Ring) => {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  };
  const withArea = norm.map((r) => ({ r, a: area(r) }));
  const outers = withArea.filter((x) => x.a > 0).sort((p, q) => q.a - p.a);
  const holes = withArea.filter((x) => x.a < 0);

  const inRing = (p: Pt, ring: Ring): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  const mp: MultiPoly = outers.map((o) => [o.r]);
  for (const hle of holes) {
    // 找最小的包含它的外环
    let best = -1;
    let bestArea = Infinity;
    outers.forEach((o, i) => {
      if (o.a < bestArea && inRing(hle.r[0], o.r)) {
        best = i;
        bestArea = o.a;
      }
    });
    if (best >= 0) mp[best].push(hle.r);
  }
  return mp;
}
