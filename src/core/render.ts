/**
 * Canvas 渲染:HiDPI 适配、毫米标尺(随缩放联动)、MultiPoly 填充、十字定位线。
 */
import { MultiPoly } from './polygon';
import { Pt } from './geom';

export interface View {
  /** 屏幕 px / mm */
  pxPerMm: number;
  /** 视口原点对应的毫米坐标 */
  oxMm: number;
  oyMm: number;
}

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function mmToPx(v: View, p: Pt): Pt {
  return { x: (p.x - v.oxMm) * v.pxPerMm, y: (p.y - v.oyMm) * v.pxPerMm };
}

export function pxToMm(v: View, p: Pt): Pt {
  return { x: p.x / v.pxPerMm + v.oxMm, y: p.y / v.pxPerMm + v.oyMm };
}

export function multiPolyToPath2D(mp: MultiPoly, v: View): Path2D {
  const path = new Path2D();
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length === 0) continue;
      const p0 = mmToPx(v, ring[0]);
      path.moveTo(p0.x, p0.y);
      for (let i = 1; i < ring.length; i++) {
        const p = mmToPx(v, ring[i]);
        path.lineTo(p.x, p.y);
      }
      path.closePath();
    }
  }
  return path;
}

export function fillMultiPoly(ctx: CanvasRenderingContext2D, mp: MultiPoly, v: View, color: string) {
  ctx.fillStyle = color;
  ctx.fill(multiPolyToPath2D(mp, v), 'evenodd');
}

/** 标尺刻度步长:保证刻度间距不小于 45px */
export function rulerStep(pxPerMm: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  for (const s of steps) if (s * pxPerMm >= 45) return s;
  return 1000;
}

export function drawRulers(
  ctx: CanvasRenderingContext2D,
  v: View,
  widthPx: number,
  heightPx: number,
  corner = 24
) {
  const step = rulerStep(v.pxPerMm);
  ctx.save();
  ctx.fillStyle = '#f5f2ec';
  ctx.strokeStyle = '#b8b0a0';
  ctx.lineWidth = 1;
  ctx.font = '9px sans-serif';
  ctx.fillRect(0, 0, widthPx, corner);
  ctx.fillRect(0, 0, corner, heightPx);
  ctx.fillStyle = '#8a8272';
  ctx.strokeRect(-0.5, -0.5, widthPx + 1, corner + 0.5);
  ctx.strokeRect(-0.5, -0.5, corner + 0.5, heightPx + 1);

  const startX = Math.floor(v.oxMm / step) * step;
  for (let mm = startX; ; mm += step) {
    const x = (mm - v.oxMm) * v.pxPerMm;
    if (x > widthPx) break;
    if (x < corner) continue;
    ctx.beginPath();
    ctx.moveTo(x, corner);
    ctx.lineTo(x, corner - (mm % (step * 5) === 0 ? 12 : 6));
    ctx.stroke();
    if (mm % (step * 5) === 0) ctx.fillText(`${mm}`, x + 2, corner - 13);
  }
  const startY = Math.floor(v.oyMm / step) * step;
  for (let mm = startY; ; mm += step) {
    const y = (mm - v.oyMm) * v.pxPerMm;
    if (y > heightPx) break;
    if (y < corner) continue;
    ctx.beginPath();
    ctx.moveTo(corner, y);
    ctx.lineTo(corner - (mm % (step * 5) === 0 ? 12 : 6), y);
    ctx.stroke();
    if (mm % (step * 5) === 0) {
      ctx.save();
      ctx.translate(corner - 13, y + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${mm}`, -ctx.measureText(`${mm}`).width, 0);
      ctx.restore();
    }
  }
  ctx.fillStyle = '#8a8272';
  ctx.fillText('mm', 4, 12);
  ctx.restore();
}

/** 十字定位线(虚线,贯穿画布) */
export function drawCrosshair(ctx: CanvasRenderingContext2D, v: View, atMm: Pt, w: number, h: number, color = '#2f6fdd') {
  const p = mmToPx(v, atMm);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, p.y);
  ctx.lineTo(w, p.y);
  ctx.moveTo(p.x, 0);
  ctx.lineTo(p.x, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** 纸张底色 */
export const PAPER_COLOR = '#f8f4ea';
export const STONE_COLOR = '#efe9dd';
