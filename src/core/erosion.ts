/**
 * 做旧残破:全部矢量布尔运算。
 * - 崩边:沿墨迹边缘按种子随机布点,减去不规则多边形缺口;
 * - 斑驳:墨迹内部按种子随机减去小麻点;
 * - 橡皮:用户擦除(减)与补回(与原始墨迹求交后并回),操作即数据,完全可复现。
 */
import { Pt } from './geom';
import { MultiPoly, mpSubtract, mpUnion, mpIntersect, sampleEdges, pointInMultiPoly, mpBBox, disk } from './polygon';
import { seededRng, rngRange, rngInt, Rng } from './rng';

export interface EraserOp {
  x: number; // mm
  y: number;
  r: number; // 半径 mm
  mode: 'erase' | 'restore';
}

/** 不规则崩口多边形(中心 px,py,半径 r,顶点数与半径抖动都由 rng 决定) */
function chipBlob(rng: Rng, cx: number, cy: number, r: number): MultiPoly {
  const n = rngInt(rng, 6, 10);
  const ring: Pt[] = [];
  const start = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = start + (i / n) * Math.PI * 2;
    const rr = r * rngRange(rng, 0.45, 1.0);
    ring.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) });
  }
  return [[ring]];
}

export function applyErosion(
  ink: MultiPoly,
  inkOriginal: MultiPoly,
  strength: number, // 0-100
  seed: number,
  eraser: EraserOp[]
): MultiPoly {
  let out = ink;
  const s = Math.max(0, Math.min(100, strength)) / 100;

  if (s > 0) {
    const rng = seededRng(seed);
    // 1) 崩边:沿边缘每 0.3mm 采样,按力度概率啃掉一块
    const edgePts = sampleEdges(out, 0.3);
    const chips: MultiPoly[] = [];
    const chipP = s * 0.5;
    const chipR = 0.15 + s * 0.85; // 崩口半径上限 ~1mm
    for (const p of edgePts) {
      if (rng() < chipP) {
        chips.push(chipBlob(rng, p.x, p.y, rngRange(rng, chipR * 0.35, chipR)));
      }
    }
    if (chips.length > 0) {
      let chipUnion: MultiPoly = [];
      for (const c of chips) chipUnion = mpUnion(chipUnion, c);
      out = mpSubtract(out, chipUnion);
    }

    // 2) 斑驳:内部麻点
    const box = mpBBox(out);
    if (box) {
      const specks: MultiPoly[] = [];
      const area = (box.maxX - box.minX) * (box.maxY - box.minY);
      const tries = Math.floor(area * s * 1.2);
      for (let i = 0; i < tries; i++) {
        const p: Pt = {
          x: rngRange(rng, box.minX, box.maxX),
          y: rngRange(rng, box.minY, box.maxY),
        };
        if (pointInMultiPoly(p, out) && rng() < 0.5) {
          specks.push(chipBlob(rng, p.x, p.y, rngRange(rng, 0.05, 0.1 + s * 0.3)));
        }
      }
      if (specks.length > 0) {
        let spUnion: MultiPoly = [];
        for (const c of specks) spUnion = mpUnion(spUnion, c);
        out = mpSubtract(out, spUnion);
      }
    }
  }

  // 3) 橡皮(在种子残破之后按顺序应用,结果依然确定)
  for (const op of eraser) {
    const d: MultiPoly = [disk(op.x, op.y, op.r, 14)];
    if (op.mode === 'erase') {
      out = mpSubtract(out, d);
    } else {
      // 补回:只补原本有墨的地方
      out = mpUnion(out, mpIntersect(inkOriginal, d));
    }
  }

  return out;
}
