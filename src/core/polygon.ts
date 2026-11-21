/**
 * 多边形矢量内核:环形路径、笔画膨胀成轮廓、布尔运算(并/差/交)。
 * 做旧崩边、朱白文转换全部走这里的矢量布尔,不用任何贴图。
 */
import pc from 'polygon-clipping';
import { Pt, Mat, matApply, BBox, bboxOf, bboxMerge } from './geom';

/** 一条闭合环(毫米坐标) */
export type Ring = Pt[];
/** 一个多边形 = 外环 + 若干孔环 */
export type Poly = Ring[];
/** 多边形集合 */
export type MultiPoly = Poly[];

type PcRing = [number, number][];
type PcPoly = PcRing[];
type PcMulti = PcPoly[];

function toPc(mp: MultiPoly): PcMulti {
  return mp.map((poly) => poly.map((ring) => ring.map((p) => [p.x, p.y] as [number, number])));
}

function fromPc(mp: PcMulti): MultiPoly {
  return mp.map((poly) =>
    poly.map((ring) => {
      // polygon-clipping 输出的环首尾重复,去掉末点
      const pts = ring.map(([x, y]) => ({ x, y }));
      if (pts.length > 1) {
        const a = pts[0];
        const b = pts[pts.length - 1];
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) pts.pop();
      }
      return pts;
    })
  );
}

export function mpUnion(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return fromPc(pc.union(toPc(a) as never, toPc(b) as never) as unknown as PcMulti);
}

export function mpUnionAll(parts: MultiPoly[]): MultiPoly {
  let acc: MultiPoly = [];
  for (const p of parts) acc = mpUnion(acc, p);
  return acc;
}

export function mpSubtract(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  return fromPc(pc.difference(toPc(a) as never, toPc(b) as never) as unknown as PcMulti);
}

export function mpIntersect(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return [];
  return fromPc(pc.intersection(toPc(a) as never, toPc(b) as never) as unknown as PcMulti);
}

export function mpTransform(mp: MultiPoly, m: Mat): MultiPoly {
  return mp.map((poly) => poly.map((ring) => ring.map((p) => matApply(m, p))));
}

export function mpBBox(mp: MultiPoly): BBox | null {
  let box: BBox | null = null;
  for (const poly of mp) for (const ring of poly) box = bboxMerge(box, bboxOf(ring));
  return box;
}

/** 圆近似多边形 */
export function disk(cx: number, cy: number, r: number, seg = 12): Poly {
  const ring: Ring = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    ring.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return [ring];
}

/** 矩形(可带圆角,r 为圆角半径 mm) */
export function rectPoly(x: number, y: number, w: number, h: number, r = 0): Poly {
  const ring: Ring = [];
  const rr = Math.min(r, w / 2, h / 2);
  if (rr <= 0) {
    ring.push({ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h });
    return [ring];
  }
  const corners: [number, number, number][] = [
    [x + w - rr, y + rr, -90],
    [x + w - rr, y + h - rr, 0],
    [x + rr, y + h - rr, 90],
    [x + rr, y + rr, 180],
  ];
  const seg = 6;
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = ((start + (i / seg) * 90) * Math.PI) / 180;
      ring.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) });
    }
  }
  return [ring];
}

/** 环形边框 = 外矩形 - 内矩形 */
export function borderRing(x: number, y: number, w: number, h: number, width: number, cornerR: number): MultiPoly {
  const outer = rectPoly(x, y, w, h, cornerR);
  const inner = rectPoly(x + width, y + width, w - width * 2, h - width * 2, Math.max(0, cornerR - width));
  return mpSubtract([outer], [inner]);
}

/**
 * 把一条折线笔画(中心线 + 宽度)膨胀成轮廓多边形。
 * 每段生成矩形、每个关节生成圆盘,再全部做矢量并集 —— 圆头圆角,放大不糊。
 */
export function strokeToPoly(pts: Pt[], width: number): MultiPoly {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [disk(pts[0].x, pts[0].y, width / 2)];
  const parts: MultiPoly[] = [];
  const hw = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const nx = (-(b.y - a.y) / len) * hw;
    const ny = ((b.x - a.x) / len) * hw;
    const quad: Ring = [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ];
    parts.push([[quad]]);
  }
  for (const p of pts) parts.push([disk(p.x, p.y, hw, 10)]);
  return mpUnionAll(parts);
}

/** 射线法点在环内测试 */
export function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInMultiPoly(p: Pt, mp: MultiPoly): boolean {
  for (const poly of mp) {
    if (pointInRing(p, poly[0])) {
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(p, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/** 沿多边形所有外环与孔环均匀采样边界点(用于崩边定位) */
export function sampleEdges(mp: MultiPoly, stepMm: number): Pt[] {
  const out: Pt[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.floor(len / stepMm));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
    }
  }
  return out;
}

/** MultiPoly → SVG path 字符串(矢量导出用) */
export function mpToSvgPath(mp: MultiPoly, precision = 3): string {
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length === 0) continue;
      const f = (v: number) => v.toFixed(precision);
      parts.push(`M${f(ring[0].x)},${f(ring[0].y)}`);
      for (let i = 1; i < ring.length; i++) parts.push(`L${f(ring[i].x)},${f(ring[i].y)}`);
      parts.push('Z');
    }
  }
  return parts.join('');
}
