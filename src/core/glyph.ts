/**
 * 字形模型:篆字以「笔画中心线 + 线宽」存储(100×100 em 框),
 * 也支持导入图描摹后的多边形字形。两种都最终展开成矢量轮廓。
 */
import { Pt } from './geom';
import { MultiPoly, strokeToPoly, mpTransform } from './polygon';
import { matScale, matTranslate, matMultiply } from './geom';

export interface Stroke {
  pts: Pt[];
  w: number; // 线宽(em 单位,100em 框)
}

export interface StrokeGlyph {
  kind: 'stroke';
  strokes: Stroke[];
}

export interface PolyGlyph {
  kind: 'poly';
  poly: MultiPoly; // 100em 框坐标
}

export type GlyphData = StrokeGlyph | PolyGlyph;

/** 字形 → em 框内的矢量轮廓 */
export function glyphToPoly(g: GlyphData): MultiPoly {
  if (g.kind === 'poly') return g.poly;
  const parts: MultiPoly[] = g.strokes.map((s) => strokeToPoly(s.pts, s.w));
  const out: MultiPoly = [];
  for (const p of parts) out.push(...p);
  return out;
}

/** em 框(0-100) → 毫米框(以 sizeMm 为边长,左上角 ox,oy) */
export function emToMm(mp: MultiPoly, ox: number, oy: number, sizeMm: number): MultiPoly {
  const m = matMultiply(matTranslate(ox, oy), matScale(sizeMm / 100, sizeMm / 100));
  return mpTransform(mp, m);
}

/** 缺字占位:田字格 + 叉 */
export function missingGlyphPoly(): MultiPoly {
  const s = (pts: number[][], w: number): MultiPoly =>
    strokeToPoly(pts.map(([x, y]) => ({ x, y })), w);
  return [
    ...s([[12, 12], [88, 12], [88, 88], [12, 88], [12, 12]], 4),
    ...s([[25, 25], [75, 75]], 5),
    ...s([[75, 25], [25, 75]], 5),
  ];
}
