/**
 * 印稿设计页:真实毫米画布 + 标尺、反字镜像、单字旋转/斜切/等比缩放、
 * 字距行距拖拽、朱白文、边框、做旧橡皮、边款、SVG 矢量导出。
 */
import { store } from '../core/store';
import { Seal, charPoly, defaultCharTransform, maybeMirror, contentBox, createSeal } from '../core/seal';
import { getSealGeometry } from '../core/cache';
import { TEMPLATES, defaultTemplateFor } from '../core/templates';
import { View, setupCanvas, mmToPx, pxToMm, fillMultiPoly, drawRulers, STONE_COLOR } from '../core/render';
import { Pt, BBox, dist, clamp, round1 } from '../core/geom';
import { mpBBox, mpToSvgPath } from '../core/polygon';

type Mode = 'select' | 'erase' | 'restore';

export function mountDesign(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel left">
      <h3>印稿</h3>
      <div class="row"><select id="sealSel" style="flex:1"></select></div>
      <div class="btn-row">
        <button id="newSeal">新建</button>
        <button id="dupSeal">复制</button>
        <button id="delSeal" class="danger">删除</button>
      </div>
      <div class="row"><label>名称</label><input type="text" id="sealName"></div>
      <h3>印面(毫米)</h3>
      <div class="row"><label>宽 mm</label><input type="number" id="sealW" step="0.1" min="5" max="200"></div>
      <div class="row"><label>高 mm</label><input type="number" id="sealH" step="0.1" min="5" max="200"></div>
      <div class="row"><label>印文</label><input type="text" id="sealText"></div>
      <div id="missingWarn" class="hint"></div>
      <div class="row"><label>章法</label><select id="tplSel"></select></div>
      <h3>朱白 / 边框</h3>
      <div class="btn-row">
        <button id="styleZhu">朱文</button>
        <button id="styleBai">白文</button>
      </div>
      <div class="row"><label>边框</label><select id="borderType">
        <option value="none">无边</option>
        <option value="thin">细朱(方角)</option>
        <option value="thick">满白(宽边)</option>
        <option value="round">圆角</option>
      </select></div>
      <div class="row"><label>边宽 mm</label><input type="number" id="borderW" step="0.1" min="0.2" max="5"></div>
      <h3>字距行距(可拖画布内手柄)</h3>
      <div class="row"><label>列距 mm</label><input type="range" id="gapX" min="0" max="10" step="0.1"><span class="val" id="gapXV"></span></div>
      <div class="row"><label>行距 mm</label><input type="range" id="gapY" min="0" max="10" step="0.1"><span class="val" id="gapYV"></span></div>
      <h3>上石</h3>
      <div class="btn-row"><button id="mirrorBtn">反字镜像</button></div>
      <div class="hint">镜像后即为上石反字,打印/导出均按镜像出图。</div>
    </div>
    <div class="scroll-col" style="display:flex;flex-direction:column">
      <div class="toolbar-strip">
        <button id="zoomOut">−</button>
        <span id="zoomLabel" class="hint" style="min-width:52px;text-align:center"></span>
        <button id="zoomIn">＋</button>
        <button id="zoomFit">适应</button>
        <span class="sep"></span>
        <button id="modeSelect" class="active">选择/移动</button>
        <button id="modeErase">橡皮·修掉</button>
        <button id="modeRestore">橡皮·补回</button>
        <span class="sep"></span>
        <span class="hint">滚轮缩放 · 拖空白平移 · 拖字移动 · 拖角柄缩放/旋转</span>
      </div>
      <div class="canvas-wrap"><canvas id="cv"></canvas></div>
    </div>
    <div class="panel right">
      <h3>选中字</h3>
      <div id="charInfo" class="hint">点击画布中的字选中</div>
      <div class="row"><label>旋转 °</label><input type="number" id="tRot" step="1"></div>
      <div class="row"><label>斜切 °</label><input type="number" id="tSkew" step="1"></div>
      <div class="row"><label>缩放 %</label><input type="number" id="tScale" step="1" min="20" max="300"></div>
      <div class="row"><label>偏移X</label><input type="number" id="tDx" step="0.1"></div>
      <div class="row"><label>偏移Y</label><input type="number" id="tDy" step="0.1"></div>
      <div class="btn-row"><button id="tReset">复位此字</button></div>
      <h3>做旧残破(矢量)</h3>
      <div class="row"><label>力度</label><input type="range" id="eroStrength" min="0" max="100" step="1"><span class="val" id="eroStrengthV"></span></div>
      <div class="row"><label>种子</label><input type="number" id="eroSeed" step="1" min="1"></div>
      <div class="btn-row"><button id="eroReroll">换一种残破</button><button id="eroClearEraser">清空橡皮</button></div>
      <div class="hint">同一种子残边完全一致;局部不满意用左侧橡皮修掉或补回。</div>
      <h3>边款</h3>
      <div id="sideList"></div>
      <div class="btn-row"><button id="addSide">＋加边款</button></div>
      <h3>导出</h3>
      <div class="btn-row"><button id="exportSvg" class="primary">导出 SVG(矢量)</button></div>
      <div id="sizeInfo" class="hint"></div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const canvas = $<HTMLCanvasElement>('#cv');
  let ctx: CanvasRenderingContext2D;
  let view: View = { pxPerMm: 8, oxMm: -10, oyMm: -10 };
  let selected = -1;
  let mode: Mode = 'select';
  let eraserR = 1.2;
  let fitted = false;

  // ---------- 数据 ----------
  const seal = (): Seal => {
    let s = store.currentSeal();
    if (!s) {
      s = createSeal(store.uid());
      store.addSeal(s);
    }
    return s;
  };

  function syncPanel() {
    const s = seal();
    if (!s) return;
    $<HTMLSelectElement>('#sealSel').innerHTML = store.seals
      .map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${x.name}</option>`)
      .join('');
    $<HTMLInputElement>('#sealName').value = s.name;
    $<HTMLInputElement>('#sealW').value = String(s.widthMm);
    $<HTMLInputElement>('#sealH').value = String(s.heightMm);
    $<HTMLInputElement>('#sealText').value = s.text;
    const tplSel = $<HTMLSelectElement>('#tplSel');
    tplSel.innerHTML = TEMPLATES.map((t) => `<option value="${t.id}" ${t.id === s.templateId ? 'selected' : ''}>${t.name}</option>`).join('');
    $<HTMLButtonElement>('#styleZhu').classList.toggle('active', s.style === 'zhu');
    $<HTMLButtonElement>('#styleBai').classList.toggle('active', s.style === 'bai');
    $<HTMLSelectElement>('#borderType').value = s.border.type;
    $<HTMLInputElement>('#borderW').value = String(s.border.widthMm);
    $<HTMLInputElement>('#gapX').value = String(s.charGapMm);
    $<HTMLInputElement>('#gapY').value = String(s.lineGapMm);
    $('#gapXV').textContent = s.charGapMm.toFixed(1);
    $('#gapYV').textContent = s.lineGapMm.toFixed(1);
    $<HTMLButtonElement>('#mirrorBtn').classList.toggle('active', s.mirror);
    $<HTMLInputElement>('#eroStrength').value = String(s.erosion.strength);
    $('#eroStrengthV').textContent = String(s.erosion.strength);
    $<HTMLInputElement>('#eroSeed').value = String(s.erosion.seed);

    // 缺字提示
    const missing = [...s.text].filter((ch) => ch.trim() && !store.resolveGlyph(ch));
    $('#missingWarn').innerHTML = missing.length
      ? `缺字:<span class="missing-char">${missing.join(' ')}</span> — 到「篆字库」拼偏旁或导入字形`
      : '';

    // 选中字变换
    const t = s.transforms[selected] ?? defaultCharTransform();
    const hasSel = selected >= 0 && selected < [...s.text].length;
    for (const id of ['#tRot', '#tSkew', '#tScale', '#tDx', '#tDy']) $(id).toggleAttribute('disabled', !hasSel);
    $<HTMLInputElement>('#tRot').value = String(t.rot);
    $<HTMLInputElement>('#tSkew').value = String(t.skew);
    $<HTMLInputElement>('#tScale').value = String(Math.round(t.scale * 100));
    $<HTMLInputElement>('#tDx').value = String(t.dx);
    $<HTMLInputElement>('#tDy').value = String(t.dy);

    // 实际毫米尺寸
    const geom = getSealGeometry(s);
    let sizeHtml = `印面实际尺寸:${s.widthMm} × ${s.heightMm} mm`;
    if (hasSel) {
      const poly = charPoly(s, geom.cells[selected], store.resolveGlyph);
      const bb = mpBBox(poly);
      if (bb) {
        sizeHtml += `<br>选中字「${[...s.text][selected]}」墨迹尺寸:${round1(bb.maxX - bb.minX)} × ${round1(bb.maxY - bb.minY)} mm`;
      }
    }
    $('#sizeInfo').innerHTML = sizeHtml;
    $('#charInfo').innerHTML = hasSel
      ? `第 ${selected + 1} 字「${[...s.text][selected]}」`
      : '点击画布中的字选中';

    renderSideList();
  }

  function renderSideList() {
    const s = seal();
    const host = $('#sideList');
    host.innerHTML = '';
    s.sideTexts.forEach((st, i) => {
      const div = document.createElement('div');
      div.style.borderTop = '1px dashed var(--panel-border)';
      div.style.padding = '4px 0';
      div.innerHTML = `
        <div class="row"><label>内容</label><input type="text" data-k="text" value="${st.text}"></div>
        <div class="row"><label>字体</label><select data-k="font">
          <option value="kai" ${st.font === 'kai' ? 'selected' : ''}>楷书</option>
          <option value="li" ${st.font === 'li' ? 'selected' : ''}>隶书</option>
        </select></div>
        <div class="row"><label>字大mm</label><input type="number" data-k="sizeMm" step="0.1" min="1" value="${st.sizeMm}"></div>
        <div class="row"><label>位置X</label><input type="number" data-k="xMm" step="0.1" value="${st.xMm}"></div>
        <div class="row"><label>位置Y</label><input type="number" data-k="yMm" step="0.1" value="${st.yMm}"></div>
        <div class="btn-row">
          <button data-act="vert">${st.vertical ? '改横排' : '改竖排'}</button>
          <button data-act="del" class="danger">删除</button>
        </div>`;
      div.querySelectorAll('input,select').forEach((el) => {
        el.addEventListener('change', () => {
          const k = (el as HTMLElement).dataset.k!;
          store.mutate(() => {
            const v = (el as HTMLInputElement).value;
            const rec = s.sideTexts[i] as unknown as Record<string, string | number | boolean>;
            rec[k] = k === 'text' || k === 'font' ? v : parseFloat(v) || 0;
          });
        });
      });
      div.querySelector('[data-act="vert"]')!.addEventListener('click', () =>
        store.mutate(() => (s.sideTexts[i].vertical = !s.sideTexts[i].vertical))
      );
      div.querySelector('[data-act="del"]')!.addEventListener('click', () =>
        store.mutate(() => s.sideTexts.splice(i, 1))
      );
      host.appendChild(div);
    });
  }

  // ---------- 视图 ----------
  function fit() {
    const s = seal();
    if (!s) return;
    const rect = canvas.getBoundingClientRect();
    const margin = 30; // px
    const corner = 24;
    const availW = rect.width - margin * 2 - corner;
    const availH = rect.height - margin * 2 - corner;
    const extraLeft = s.sideTexts.length > 0 ? 30 : 0; // 边款留白
    view.pxPerMm = Math.min(availW / (s.widthMm + extraLeft), availH / s.heightMm);
    view.oxMm = -extraLeft - (availW / view.pxPerMm - s.widthMm - extraLeft) / 2 + corner / view.pxPerMm;
    view.oyMm = -(availH / view.pxPerMm - s.heightMm) / 2 + corner / view.pxPerMm;
  }

  function zoomAt(f: number, cx: number, cy: number) {
    const before = pxToMm(view, { x: cx, y: cy });
    view.pxPerMm = clamp(view.pxPerMm * f, 0.5, 200);
    const after = pxToMm(view, { x: cx, y: cy });
    view.oxMm += before.x - after.x;
    view.oyMm += before.y - after.y;
    draw();
  }

  // ---------- 绘制 ----------
  function draw() {
    const s = seal();
    if (!s) return;
    ctx = setupCanvas(canvas);
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    $('#zoomLabel').textContent = `${Math.round((view.pxPerMm / 3.7795) * 100)}%`;

    const geom = getSealGeometry(s);
    const ink = maybeMirror(geom.ink, s);

    // 印石
    const o = mmToPx(view, { x: 0, y: 0 });
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = STONE_COLOR;
    ctx.fillRect(o.x, o.y, s.widthMm * view.pxPerMm, s.heightMm * view.pxPerMm);
    ctx.restore();

    // 墨迹
    fillMultiPoly(ctx, ink, view, '#b8271a');

    // 格子辅助线
    ctx.save();
    ctx.strokeStyle = 'rgba(60,50,30,0.25)';
    ctx.setLineDash([3, 3]);
    for (const c of geom.cells) {
      const p = mmToPx(view, { x: c.cx - c.w / 2, y: c.cy - c.h / 2 });
      ctx.strokeRect(p.x, p.y, c.w * view.pxPerMm, c.h * view.pxPerMm);
    }
    ctx.restore();

    // 边款
    ctx.save();
    ctx.fillStyle = '#3a332a';
    for (const st of s.sideTexts) {
      const fontFam = st.font === 'kai' ? "'KaiTi','STKaiti',serif" : "'LiSu','STLiti',serif";
      ctx.font = `${st.sizeMm * view.pxPerMm}px ${fontFam}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const chars = [...st.text];
      if (st.vertical) {
        chars.forEach((ch, i) => {
          const p = mmToPx(view, { x: st.xMm, y: st.yMm + i * st.sizeMm * 1.15 });
          ctx.fillText(ch, p.x, p.y);
        });
      } else {
        const p = mmToPx(view, { x: st.xMm, y: st.yMm });
        ctx.fillText(st.text, p.x, p.y);
      }
    }
    ctx.restore();

    // 选中字手柄
    if (selected >= 0 && selected < geom.cells.length && mode === 'select') {
      const cell = geom.cells[selected];
      const poly = charPoly(s, cell, store.resolveGlyph);
      const bb = mpBBox(maybeMirror(poly, s));
      if (bb) {
        const p1 = mmToPx(view, { x: bb.minX, y: bb.minY });
        const p2 = mmToPx(view, { x: bb.maxX, y: bb.maxY });
        ctx.save();
        ctx.strokeStyle = '#2f6fdd';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        // 缩放柄(右下) 旋转柄(上中)
        ctx.fillStyle = '#2f6fdd';
        ctx.fillRect(p2.x - 4, p2.y - 4, 8, 8);
        const rcx = (p1.x + p2.x) / 2;
        const rcy = p1.y - 18;
        ctx.beginPath();
        ctx.moveTo(rcx, p1.y);
        ctx.lineTo(rcx, rcy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rcx, rcy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 字距/行距拖柄
    if (mode === 'select') drawGapHandles(s);

    // 橡皮光标
    if (mode !== 'select' && cursorMm) {
      const p = mmToPx(view, cursorMm);
      ctx.save();
      ctx.strokeStyle = mode === 'erase' ? '#a02020' : '#1d7a1d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, eraserR * view.pxPerMm, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawRulers(ctx, view, rect.width, rect.height);
  }

  function gapHandlePositions(s: Seal): { x: Pt; dir: 'x' | 'y' }[] {
    const tpl = TEMPLATES.find((t) => t.id === s.templateId) ?? defaultTemplateFor([...s.text].length);
    const box = contentBox(s);
    const out: { x: Pt; dir: 'x' | 'y' }[] = [];
    const cellW = (box.w - (tpl.cols - 1) * s.charGapMm) / tpl.cols;
    const cellH = (box.h - (tpl.rows - 1) * s.lineGapMm) / tpl.rows;
    for (let c = 0; c < tpl.cols - 1; c++) {
      out.push({
        x: { x: box.x + (c + 1) * cellW + c * s.charGapMm + s.charGapMm / 2, y: box.y + box.h / 2 },
        dir: 'x',
      });
    }
    for (let r = 0; r < tpl.rows - 1; r++) {
      out.push({
        x: { x: box.x + box.w / 2, y: box.y + (r + 1) * cellH + r * s.lineGapMm + s.lineGapMm / 2 },
        dir: 'y',
      });
    }
    return out;
  }

  function drawGapHandles(s: Seal) {
    ctx.save();
    ctx.fillStyle = '#b08a3c';
    for (const h of gapHandlePositions(s)) {
      const p = mmToPx(view, h.x);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x + 5, p.y);
      ctx.lineTo(p.x, p.y + 5);
      ctx.lineTo(p.x - 5, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 交互 ----------
  let cursorMm: Pt | null = null;
  type Drag =
    | { kind: 'pan'; startPx: Pt; startOx: number; startOy: number }
    | { kind: 'move'; startMm: Pt; startDx: number; startDy: number }
    | { kind: 'rotate'; centerMm: Pt; startAngle: number; startRot: number }
    | { kind: 'scale'; centerMm: Pt; startDist: number; startScale: number }
    | { kind: 'gap'; dir: 'x' | 'y'; startMm: Pt; startGap: number }
    | { kind: 'erase'; lastMm: Pt };
  let drag: Drag | null = null;

  function eventPx(e: PointerEvent | WheelEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function unmirror(s: Seal, p: Pt): Pt {
    return s.mirror ? { x: s.widthMm - p.x, y: p.y } : p;
  }

  function hitChar(s: Seal, mm: Pt): number {
    const geom = getSealGeometry(s);
    const u = unmirror(s, mm);
    for (let i = geom.cells.length - 1; i >= 0; i--) {
      const c = geom.cells[i];
      if (Math.abs(u.x - c.cx) <= c.w / 2 && Math.abs(u.y - c.cy) <= c.h / 2) return i;
    }
    return -1;
  }

  function selCharBBoxMm(s: Seal): BBox | null {
    const geom = getSealGeometry(s);
    if (selected < 0 || selected >= geom.cells.length) return null;
    const poly = charPoly(s, geom.cells[selected], store.resolveGlyph);
    return mpBBox(maybeMirror(poly, s));
  }

  canvas.addEventListener('pointerdown', (e) => {
    const s = seal();
    if (!s) return;
    canvas.setPointerCapture(e.pointerId);
    const px = eventPx(e);
    const mm = pxToMm(view, px);

    if (mode !== 'select') {
      applyEraser(s, mm);
      drag = { kind: 'erase', lastMm: mm };
      return;
    }

    // 手柄命中
    const bb = selCharBBoxMm(s);
    if (bb) {
      const p1 = mmToPx(view, { x: bb.minX, y: bb.minY });
      const p2 = mmToPx(view, { x: bb.maxX, y: bb.maxY });
      const geom = getSealGeometry(s);
      const cell = geom.cells[selected];
      const t = s.transforms[selected] ?? defaultCharTransform();
      const centerDisp = mmToPx(view, unmirrorInv(s, { x: cell.cx + t.dx, y: cell.cy + t.dy }));
      if (Math.abs(px.x - p2.x) < 8 && Math.abs(px.y - p2.y) < 8) {
        drag = { kind: 'scale', centerMm: pxToMm(view, centerDisp), startDist: Math.max(1, dist(px, centerDisp)), startScale: t.scale };
        return;
      }
      const rc = { x: (p1.x + p2.x) / 2, y: p1.y - 18 };
      if (dist(px, rc) < 9) {
        drag = {
          kind: 'rotate',
          centerMm: pxToMm(view, centerDisp),
          startAngle: (Math.atan2(px.y - centerDisp.y, px.x - centerDisp.x) * 180) / Math.PI,
          startRot: t.rot,
        };
        return;
      }
    }

    // 字距行距手柄
    for (const h of gapHandlePositions(s)) {
      const hp = mmToPx(view, h.x);
      if (dist(px, hp) < 8) {
        drag = { kind: 'gap', dir: h.dir, startMm: mm, startGap: h.dir === 'x' ? s.charGapMm : s.lineGapMm };
        return;
      }
    }

    // 字命中 → 移动
    const hit = hitChar(s, mm);
    if (hit >= 0) {
      selected = hit;
      const t = s.transforms[hit] ?? defaultCharTransform();
      drag = { kind: 'move', startMm: mm, startDx: t.dx, startDy: t.dy };
      syncPanel();
      draw();
      return;
    }

    // 空白 → 平移
    selected = -1;
    drag = { kind: 'pan', startPx: px, startOx: view.oxMm, startOy: view.oyMm };
    syncPanel();
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = seal();
    if (!s) return;
    const px = eventPx(e);
    const mm = pxToMm(view, px);
    cursorMm = mm;
    if (!drag) {
      draw();
      return;
    }
    switch (drag.kind) {
      case 'pan':
        view.oxMm = drag.startOx - (px.x - drag.startPx.x) / view.pxPerMm;
        view.oyMm = drag.startOy - (px.y - drag.startPx.y) / view.pxPerMm;
        draw();
        break;
      case 'move': {
        const d = unmirror(s, mm);
        const st = unmirror(s, drag.startMm);
        const t = { ...(s.transforms[selected] ?? defaultCharTransform()) };
        t.dx = round1(drag.startDx + (d.x - st.x));
        t.dy = round1(drag.startDy + (d.y - st.y));
        store.mutate(() => (s.transforms[selected] = t));
        break;
      }
      case 'rotate': {
        const centerPx = mmToPx(view, drag.centerMm);
        const ang = (Math.atan2(px.y - centerPx.y, px.x - centerPx.x) * 180) / Math.PI;
        const t = { ...(s.transforms[selected] ?? defaultCharTransform()) };
        t.rot = Math.round(drag.startRot + (ang - drag.startAngle));
        store.mutate(() => (s.transforms[selected] = t));
        break;
      }
      case 'scale': {
        const centerPx = mmToPx(view, drag.centerMm);
        const ratio = dist(px, centerPx) / drag.startDist;
        const t = { ...(s.transforms[selected] ?? defaultCharTransform()) };
        t.scale = clamp(Math.round(drag.startScale * ratio * 100) / 100, 0.2, 3);
        store.mutate(() => (s.transforms[selected] = t));
        break;
      }
      case 'gap': {
        const delta = drag.dir === 'x' ? mm.x - drag.startMm.x : mm.y - drag.startMm.y;
        const v = clamp(round1(drag.startGap + delta), 0, 10);
        const dir = drag.dir;
        store.mutate(() => {
          if (dir === 'x') s.charGapMm = v;
          else s.lineGapMm = v;
        });
        break;
      }
      case 'erase': {
        if (dist(mm, drag.lastMm) > eraserR * 0.6) {
          applyEraser(s, mm);
          drag.lastMm = mm;
        }
        break;
      }
    }
  });

  canvas.addEventListener('pointerup', () => {
    drag = null;
    syncPanel();
  });

  canvas.addEventListener('pointerleave', () => {
    cursorMm = null;
    draw();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = eventPx(e);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, px.x, px.y);
  }, { passive: false });

  function unmirrorInv(s: Seal, p: Pt): Pt {
    return unmirror(s, p); // 镜像关于中线自逆
  }

  function applyEraser(s: Seal, mm: Pt) {
    const u = unmirror(s, mm);
    store.mutate(() => {
      s.erosion.eraser.push({ x: u.x, y: u.y, r: eraserR, mode: mode === 'erase' ? 'erase' : 'restore' });
    });
  }

  // ---------- 面板事件 ----------
  function bind() {
    $('#sealSel').addEventListener('change', (e) => {
      store.setCurrentSeal((e.target as HTMLSelectElement).value);
      selected = -1;
      fitted = false;
    });
    $('#newSeal').addEventListener('click', () => {
      const ns = createSeal(store.uid());
      ns.name = `印稿 ${store.seals.length + 1}`;
      store.addSeal(ns);
      selected = -1;
      fitted = false;
    });
    $('#dupSeal').addEventListener('click', () => {
      const s = seal();
      const copy: Seal = JSON.parse(JSON.stringify(s));
      copy.id = store.uid();
      copy.name = s.name + ' 副本';
      copy.createdAt = Date.now();
      store.addSeal(copy);
    });
    $('#delSeal').addEventListener('click', () => {
      const s = seal();
      if (s && confirm(`删除「${s.name}」?`)) store.deleteSeal(s.id);
    });
    $('#sealName').addEventListener('change', (e) =>
      store.update(() => (seal().name = (e.target as HTMLInputElement).value))
    );
    $('#sealW').addEventListener('change', (e) =>
      store.mutate(() => (seal().widthMm = clamp(parseFloat((e.target as HTMLInputElement).value) || 25, 5, 200)))
    );
    $('#sealH').addEventListener('change', (e) =>
      store.mutate(() => (seal().heightMm = clamp(parseFloat((e.target as HTMLInputElement).value) || 25, 5, 200)))
    );
    $('#sealText').addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.replace(/\s/g, '');
      store.mutate(() => {
        const s = seal();
        s.text = v || '印';
        s.templateId = defaultTemplateFor([...s.text].length).id;
        s.transforms = {};
      });
      selected = -1;
    });
    $('#tplSel').addEventListener('change', (e) =>
      store.mutate(() => (seal().templateId = (e.target as HTMLSelectElement).value))
    );
    $('#styleZhu').addEventListener('click', () => store.mutate(() => (seal().style = 'zhu')));
    $('#styleBai').addEventListener('click', () => store.mutate(() => (seal().style = 'bai')));
    $('#borderType').addEventListener('change', (e) =>
      store.mutate(() => (seal().border.type = (e.target as HTMLSelectElement).value as Seal['border']['type']))
    );
    $('#borderW').addEventListener('change', (e) =>
      store.mutate(() => (seal().border.widthMm = clamp(parseFloat((e.target as HTMLInputElement).value) || 0.8, 0.2, 5)))
    );
    $('#gapX').addEventListener('input', (e) =>
      store.mutate(() => (seal().charGapMm = parseFloat((e.target as HTMLInputElement).value)))
    );
    $('#gapY').addEventListener('input', (e) =>
      store.mutate(() => (seal().lineGapMm = parseFloat((e.target as HTMLInputElement).value)))
    );
    $('#mirrorBtn').addEventListener('click', () => store.mutate(() => (seal().mirror = !seal().mirror)));

    $('#zoomIn').addEventListener('click', () => {
      const r = canvas.getBoundingClientRect();
      zoomAt(1.3, r.width / 2, r.height / 2);
    });
    $('#zoomOut').addEventListener('click', () => {
      const r = canvas.getBoundingClientRect();
      zoomAt(1 / 1.3, r.width / 2, r.height / 2);
    });
    $('#zoomFit').addEventListener('click', () => {
      fit();
      draw();
    });

    const setMode = (m: Mode) => {
      mode = m;
      $('#modeSelect').classList.toggle('active', m === 'select');
      $('#modeErase').classList.toggle('active', m === 'erase');
      $('#modeRestore').classList.toggle('active', m === 'restore');
      draw();
    };
    $('#modeSelect').addEventListener('click', () => setMode('select'));
    $('#modeErase').addEventListener('click', () => setMode('erase'));
    $('#modeRestore').addEventListener('click', () => setMode('restore'));

    // 单字变换数值
    const bindT = (id: string, fn: (t: ReturnType<typeof defaultCharTransform>, v: number) => void) => {
      $(id).addEventListener('change', (e) => {
        const s = seal();
        if (selected < 0) return;
        const v = parseFloat((e.target as HTMLInputElement).value) || 0;
        store.mutate(() => {
          const t = { ...(s.transforms[selected] ?? defaultCharTransform()) };
          fn(t, v);
          s.transforms[selected] = t;
        });
      });
    };
    bindT('#tRot', (t, v) => (t.rot = v));
    bindT('#tSkew', (t, v) => (t.skew = clamp(v, -45, 45)));
    bindT('#tScale', (t, v) => (t.scale = clamp(v / 100, 0.2, 3)));
    bindT('#tDx', (t, v) => (t.dx = v));
    bindT('#tDy', (t, v) => (t.dy = v));
    $('#tReset').addEventListener('click', () => {
      if (selected < 0) return;
      store.mutate(() => delete seal().transforms[selected]);
    });

    // 做旧
    $('#eroStrength').addEventListener('input', (e) =>
      store.mutate(() => (seal().erosion.strength = parseInt((e.target as HTMLInputElement).value)))
    );
    $('#eroSeed').addEventListener('change', (e) =>
      store.mutate(() => (seal().erosion.seed = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1)))
    );
    $('#eroReroll').addEventListener('click', () =>
      store.mutate(() => (seal().erosion.seed = Math.floor(Math.random() * 100000) + 1))
    );
    $('#eroClearEraser').addEventListener('click', () => store.mutate(() => (seal().erosion.eraser = [])));

    // 边款
    $('#addSide').addEventListener('click', () =>
      store.mutate(() => {
        const s = seal();
        s.sideTexts.push({
          id: store.uid(),
          text: '乙巳年 刻',
          font: 'kai',
          sizeMm: 4,
          xMm: -12,
          yMm: 2,
          vertical: true,
        });
      })
    );

    // 导出 SVG
    $('#exportSvg').addEventListener('click', () => {
      const s = seal();
      const geom = getSealGeometry(s);
      const ink = maybeMirror(geom.ink, s);
      const d = mpToSvgPath(ink);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s.widthMm}mm" height="${s.heightMm}mm" viewBox="0 0 ${s.widthMm} ${s.heightMm}"><path d="${d}" fill="#b8271a" fill-rule="evenodd"/></svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.name}.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  const unsub = store.subscribe(() => {
    if (!fitted) {
      fit();
      fitted = true;
    }
    syncPanel();
    draw();
  });

  const onResize = () => {
    if (!fitted) fit();
    draw();
  };
  window.addEventListener('resize', onResize);

  bind();
  syncPanel();
  fit();
  fitted = true;
  draw();

  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
  };
}
