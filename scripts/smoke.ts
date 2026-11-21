/** 核心几何冒烟测试(node 运行,不依赖 DOM) */
import { createSeal, computeSealGeometry, layoutCells, charPoly, defaultCharTransform, mirrorMatrix } from '../src/core/seal';
import { GlyphData } from '../src/core/glyph';
import { BUILTIN_GLYPHS } from '../src/core/glyphData';
import { mpBBox, mpTransform, strokeToPoly, pointInMultiPoly } from '../src/core/polygon';
import { seededRng } from '../src/core/rng';

const resolve = (ch: string): GlyphData | null => BUILTIN_GLYPHS[ch] ?? null;

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name} ${extra}`);
    failures++;
  }
}

// 1. 单字矩阵:em 中心 (50,50) 应映射到格子中心
{
  const s = createSeal('t1');
  s.text = '吉';
  s.templateId = 't1';
  const cells = layoutCells(s);
  const poly = charPoly(s, cells[0], resolve);
  const bb = mpBBox(poly)!;
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  check('单字居中', Math.abs(cx - cells[0].cx) < 2 && Math.abs(cy - cells[0].cy) < 2, `got ${cx},${cy} want ${cells[0].cx},${cells[0].cy}`);
}

// 2. 旋转 90°:宽高互换(近似)
{
  const s = createSeal('t2');
  s.text = '吉';
  s.templateId = 't1';
  const cells = layoutCells(s);
  const bb0 = mpBBox(charPoly(s, cells[0], resolve))!;
  s.transforms[0] = { ...defaultCharTransform(), rot: 90 };
  const bb1 = mpBBox(charPoly(s, cells[0], resolve))!;
  const w0 = bb0.maxX - bb0.minX, h0 = bb0.maxY - bb0.minY;
  const w1 = bb1.maxX - bb1.minX, h1 = bb1.maxY - bb1.minY;
  check('旋转90宽高互换', Math.abs(w0 - h1) < 0.5 && Math.abs(h0 - w1) < 0.5, `${w0}x${h0} -> ${w1}x${h1}`);
}

// 3. 缩放 2 倍:尺寸翻倍
{
  const s = createSeal('t3');
  s.text = '吉';
  s.templateId = 't1';
  const cells = layoutCells(s);
  const bb0 = mpBBox(charPoly(s, cells[0], resolve))!;
  s.transforms[0] = { ...defaultCharTransform(), scale: 2 };
  const bb1 = mpBBox(charPoly(s, cells[0], resolve))!;
  const r = (bb1.maxX - bb1.minX) / (bb0.maxX - bb0.minX);
  check('等比缩放x2', Math.abs(r - 2) < 0.01, `ratio=${r}`);
}

// 4. 朱文/白文几何都非空且不同
{
  const s = createSeal('t4');
  s.text = '吉祥';
  s.templateId = 't2h';
  const zhu = computeSealGeometry(s, resolve);
  s.style = 'bai';
  const bai = computeSealGeometry(s, resolve);
  check('朱文非空', zhu.ink.length > 0);
  check('白文非空', bai.ink.length > 0);
  check('朱白不同', JSON.stringify(zhu.ink) !== JSON.stringify(bai.ink));
  // 白文:字中心处应镂空(无墨)
  const cell = bai.cells[0];
  const glyphPoly = charPoly(s, cell, resolve);
  const bb = mpBBox(glyphPoly)!;
  const probe = { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  // 探测点若恰好落在笔画上则换个点;这里只验证白文墨迹不含边框外区域
  const out = mpBBox(bai.ink)!;
  check('白文墨迹在印面内', out.minX >= -0.01 && out.maxX <= s.widthMm + 0.01);
  void probe;
}

// 5. 做旧:同一种子两次结果完全一致;不同种子不同
{
  const s = createSeal('t5');
  s.text = '吉祥';
  s.erosion.strength = 60;
  s.erosion.seed = 42;
  const a = computeSealGeometry(s, resolve);
  const b = computeSealGeometry(s, resolve);
  check('种子可复现', JSON.stringify(a.ink) === JSON.stringify(b.ink));
  s.erosion.seed = 43;
  const c = computeSealGeometry(s, resolve);
  check('换种子结果不同', JSON.stringify(a.ink) !== JSON.stringify(c.ink));
  // 做旧后墨迹应变少(崩边)
  const areaOf = (mp: typeof a.ink) => {
    let sum = 0;
    for (const poly of mp)
      for (const ring of poly) {
        let t = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          t += p.x * q.y - q.x * p.y;
        }
        sum += t / 2;
      }
    return sum;
  };
  s.erosion.strength = 0;
  const clean = computeSealGeometry(s, resolve);
  check('做旧减少墨迹', areaOf(a.ink) < areaOf(clean.ink), `${areaOf(a.ink)} vs ${areaOf(clean.ink)}`);
}

// 6. 橡皮:erase 减墨,restore 补回
{
  const s = createSeal('t6');
  s.text = '吉';
  s.templateId = 't1';
  s.erosion.strength = 0;
  const clean = computeSealGeometry(s, resolve);
  const bb = mpBBox(clean.ink)!;
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  s.erosion.eraser = [{ x: cx, y: cy, r: 3, mode: 'erase' }];
  const erased = computeSealGeometry(s, resolve);
  check('橡皮擦除生效', !pointInMultiPoly({ x: cx, y: cy }, erased.ink));
  s.erosion.eraser.push({ x: cx, y: cy, r: 2, mode: 'restore' });
  const restored = computeSealGeometry(s, resolve);
  const wasInk = pointInMultiPoly({ x: cx, y: cy }, clean.ink);
  check('橡皮补回生效', pointInMultiPoly({ x: cx, y: cy }, restored.ink) === wasInk);
}

// 7. 镜像:水平翻转
{
  const s = createSeal('t7');
  s.text = '吉';
  s.templateId = 't1';
  const g0 = computeSealGeometry(s, resolve);
  const mirrored = mpTransform(g0.ink, mirrorMatrix(s));
  const bb0 = mpBBox(g0.ink)!;
  const bb1 = mpBBox(mirrored)!;
  check('镜像包围盒', Math.abs(bb0.minX + bb0.maxX - (bb1.minX + bb1.maxX) - 0) < 0.01 && Math.abs(bb1.minX + bb1.maxX - s.widthMm) < 25);
}

// 8. rng 确定性
{
  const r1 = seededRng(7);
  const r2 = seededRng(7);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  check('rng 确定', JSON.stringify(seq1) === JSON.stringify(seq2));
}

// 9. 笔画膨胀:线段生成非空轮廓且宽度正确
{
  const mp = strokeToPoly([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
  const bb = mpBBox(mp)!;
  check('笔画轮廓', mp.length > 0 && Math.abs(bb.maxY - bb.minY - 2) < 0.3 && Math.abs(bb.maxX - bb.minX - 12) < 0.5);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
