/**
 * 印稿模型与几何计算:把印文按章法模板落格,逐字应用旋转/斜切/等比缩放,
 * 生成朱文/白文矢量轮廓,再做种子化做旧。全部在毫米坐标系下进行。
 */
import { Pt, Mat, matMultiply, matTranslate, matScale, matRotate, matSkewX, matAbout, IDENTITY } from './geom';
import { MultiPoly, mpUnionAll, mpSubtract, mpTransform, borderRing, rectPoly, mpUnion, mpIntersect, disk } from './polygon';
import { GlyphData, glyphToPoly, missingGlyphPoly } from './glyph';
import { getTemplate, LayoutTemplate } from './templates';
import { applyErosion, EraserOp } from './erosion';

export type SealStyle = 'zhu' | 'bai';
export type BorderType = 'none' | 'thin' | 'thick' | 'round';
export type SealStatus = 'pending' | 'carved' | 'delivered';

export interface CharTransform {
  rot: number; // 旋转(度)
  skew: number; // 水平斜切(度)
  scale: number; // 等比缩放(1 = 100%)
  dx: number; // 水平偏移 mm
  dy: number; // 垂直偏移 mm
}

export const defaultCharTransform = (): CharTransform => ({ rot: 0, skew: 0, scale: 1, dx: 0, dy: 0 });

export interface SideText {
  id: string;
  text: string;
  font: 'kai' | 'li';
  sizeMm: number;
  xMm: number; // 相对印面左上角
  yMm: number;
  vertical: boolean;
}

export interface Seal {
  id: string;
  name: string;
  orderId: string | null;
  status: SealStatus;
  widthMm: number;
  heightMm: number;
  text: string;
  templateId: string;
  style: SealStyle;
  border: { type: BorderType; widthMm: number };
  charGapMm: number; // 列距
  lineGapMm: number; // 行距
  mirror: boolean; // 反字(上石用)
  erosion: { strength: number; seed: number; eraser: EraserOp[] };
  transforms: Record<number, CharTransform>;
  sideTexts: SideText[];
  createdAt: number;
  updatedAt: number;
  deliveredAt: number | null;
}

export function createSeal(id: string, orderId: string | null = null): Seal {
  const now = Date.now();
  return {
    id,
    name: '未命名印稿',
    orderId,
    status: 'pending',
    widthMm: 25,
    heightMm: 25,
    text: '吉祥',
    templateId: 't2h',
    style: 'zhu',
    border: { type: 'thin', widthMm: 0.8 },
    charGapMm: 1.5,
    lineGapMm: 1.5,
    mirror: false,
    erosion: { strength: 0, seed: 1, eraser: [] },
    transforms: {},
    sideTexts: [],
    createdAt: now,
    updatedAt: now,
    deliveredAt: null,
  };
}

export interface CharCell {
  index: number;
  cx: number; // 格子中心 mm
  cy: number;
  w: number;
  h: number;
}

/** 内容区(扣除边框与边距) */
export function contentBox(seal: Seal): { x: number; y: number; w: number; h: number } {
  const bw = seal.border.type === 'none' ? 0 : seal.border.widthMm;
  const pad = bw + 0.8;
  return {
    x: pad,
    y: pad,
    w: Math.max(1, seal.widthMm - pad * 2),
    h: Math.max(1, seal.heightMm - pad * 2),
  };
}

/** 每个字的落格(毫米) */
export function layoutCells(seal: Seal): CharCell[] {
  const chars = [...seal.text];
  const tpl: LayoutTemplate = getTemplate(seal.templateId);
  const box = contentBox(seal);
  const cellW = (box.w - (tpl.cols - 1) * seal.charGapMm) / tpl.cols;
  const cellH = (box.h - (tpl.rows - 1) * seal.lineGapMm) / tpl.rows;
  return chars.map((_, i) => {
    const [col, row] = tpl.cells[Math.min(i, tpl.cells.length - 1)];
    return {
      index: i,
      cx: box.x + col * (cellW + seal.charGapMm) + cellW / 2,
      cy: box.y + row * (cellH + seal.lineGapMm) + cellH / 2,
      w: cellW,
      h: cellH,
    };
  });
}

export type GlyphResolver = (ch: string) => GlyphData | null;

/** 单字轮廓(em → 格子,应用单字变换) */
export function charPoly(seal: Seal, cell: CharCell, resolve: GlyphResolver): MultiPoly {
  const ch = [...seal.text][cell.index];
  const glyph = resolve(ch);
  const em = glyph ? glyphToPoly(glyph) : missingGlyphPoly();
  const t = seal.transforms[cell.index] ?? defaultCharTransform();
  const size = Math.min(cell.w, cell.h) * 0.92 * t.scale;
  const center: Pt = { x: cell.cx + t.dx, y: cell.cy + t.dy };
  // em 框中心 (50,50) → 毫米:先缩放,再绕中心旋转+斜切,再平移
  const m: Mat = matMultiply(
    matTranslate(center.x, center.y),
    matMultiply(
      matAbout({ x: 0, y: 0 }, matMultiply(matRotate(t.rot), matSkewX(t.skew))),
      matMultiply(matTranslate(-50 * (size / 100), -50 * (size / 100)), matScale(size / 100, size / 100))
    )
  );
  // 上面的组合:scale(em→mm) → 平移到原点中心 → 旋转斜切 → 平移到格子中心
  return mpTransform(em, m);
}

export interface SealGeometry {
  /** 印面墨迹(朱文=字+边框;白文=印面底色减去字) */
  ink: MultiPoly;
  /** 未做旧的原始墨迹(橡皮"补回"用) */
  inkOriginal: MultiPoly;
  cells: CharCell[];
  widthMm: number;
  heightMm: number;
}

export function borderPoly(seal: Seal): MultiPoly {
  const { type, widthMm } = seal.border;
  if (type === 'none') return [];
  const r = type === 'round' ? Math.min(seal.widthMm, seal.heightMm) * 0.12 : 0;
  const w = type === 'thick' ? Math.max(widthMm, 1.6) : widthMm;
  return borderRing(0, 0, seal.widthMm, seal.heightMm, w, r);
}

/** 计算整方印的矢量几何(含做旧与橡皮) */
export function computeSealGeometry(seal: Seal, resolve: GlyphResolver): SealGeometry {
  const cells = layoutCells(seal);
  const charPolys = cells.map((c) => charPoly(seal, c, resolve));
  const charsUnion = mpUnionAll(charPolys);

  let ink: MultiPoly;
  if (seal.style === 'zhu') {
    ink = mpUnion(charsUnion, borderPoly(seal));
  } else {
    // 白文:印面整体为地,字镂空
    const r = seal.border.type === 'round' ? Math.min(seal.widthMm, seal.heightMm) * 0.12 : 0;
    const ground = rectPoly(0, 0, seal.widthMm, seal.heightMm, r);
    ink = mpSubtract([ground], charsUnion);
  }

  const inkOriginal = ink;
  if (seal.erosion.strength > 0 || seal.erosion.eraser.length > 0) {
    ink = applyErosion(ink, inkOriginal, seal.erosion.strength, seal.erosion.seed, seal.erosion.eraser);
  }

  return { ink, inkOriginal, cells, widthMm: seal.widthMm, heightMm: seal.heightMm };
}

/** 反字镜像矩阵(绕印面竖直中线翻转) */
export function mirrorMatrix(seal: Seal): Mat {
  return matMultiply(matTranslate(seal.widthMm, 0), matScale(-1, 1));
}

export function maybeMirror(mp: MultiPoly, seal: Seal): MultiPoly {
  return seal.mirror ? mpTransform(mp, mirrorMatrix(seal)) : mp;
}

/** 橡皮补回辅助:墨迹与圆形的交 */
export function inkInDisk(ink: MultiPoly, x: number, y: number, r: number): MultiPoly {
  return mpIntersect(ink, [disk(x, y, r, 16)]);
}

export { IDENTITY };
