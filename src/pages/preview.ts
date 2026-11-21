/**
 * 钤印预览页:按作品幅面摆多方印,位置/转角/大小数值精确到 0.1mm,
 * 十字定位线对齐,同一方印可多次钤盖,印泥颜色叠盖走 multiply 混合。
 */
import { store, Placement, SHEET_PRESETS, INK_COLORS } from '../core/store';
import { getSealGeometry } from '../core/cache';
import { maybeMirror } from '../core/seal';
import { View, setupCanvas, mmToPx, pxToMm, fillMultiPoly, drawCrosshair, PAPER_COLOR } from '../core/render';
import { Pt, dist, clamp, round1, matMultiply, matTranslate, matRotate, matScale } from '../core/geom';
import { mpTransform } from '../core/polygon';

export function mountPreview(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel left" style="width:270px">
      <h3>作品幅面</h3>
      <div class="row"><label>预设</label><select id="sheetPreset">
        ${SHEET_PRESETS.map((s, i) => `<option value="${i}">${s.name}</option>`).join('')}
      </select></div>
      <div class="row"><label>宽 mm</label><input type="number" id="sheetW" step="1" min="50"></div>
      <div class="row"><label>高 mm</label><input type="number" id="sheetH" step="1" min="50"></div>
      <h3>钤印</h3>
      <div class="row"><label>选印</label><select id="sealPick"></select></div>
      <div class="btn-row"><button id="addPlacement" class="primary">＋钤一方</button></div>
      <div id="placeList"></div>
      <h3>选中印(0.1mm 精度)</h3>
      <div id="noSel" class="hint">点击幅面上的印选中</div>
      <div id="selCtrls" style="display:none">
        <div class="row"><label>X mm</label><input type="number" id="pX" step="0.1"></div>
        <div class="row"><label>Y mm</label><input type="number" id="pY" step="0.1"></div>
        <div class="row"><label>转角 °</label><input type="number" id="pRot" step="0.1"></div>
        <div class="row"><label>印面mm</label><input type="number" id="pSize" step="0.1" min="1"></div>
        <div class="row"><label>印泥</label><select id="pInk">
          ${INK_COLORS.map((c) => `<option value="${c.value}">${c.name}</option>`).join('')}
        </select></div>
        <div class="row"><label>浓淡</label><input type="range" id="pAlpha" min="20" max="100" step="1"><span class="val" id="pAlphaV"></span></div>
        <div class="btn-row">
          <button id="pDup">再钤一方</button>
          <button id="pDel" class="danger">移除</button>
        </div>
      </div>
      <h3>对齐</h3>
      <div class="btn-row"><button id="crossBtn">十字定位线</button></div>
      <div class="hint">拖动时靠近其他印的中心会自动吸附(0.5mm),并显示对齐参考线。</div>
    </div>
    <div class="canvas-wrap"><canvas id="cv"></canvas></div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const canvas = $<HTMLCanvasElement>('#cv');
  let view: View = { pxPerMm: 1, oxMm: 0, oyMm: 0 };
  let selectedId: string | null = null;
  let showCross = true;
  let snapLines: { v?: number; h?: number } = {};

  function fit() {
    const r = canvas.getBoundingClientRect();
    const sheet = store.sheet;
    view.pxPerMm = Math.min((r.width - 60) / sheet.wMm, (r.height - 60) / sheet.hMm);
    view.oxMm = sheet.wMm / 2 - r.width / 2 / view.pxPerMm;
    view.oyMm = sheet.hMm / 2 - r.height / 2 / view.pxPerMm;
  }

  function placementPoly(p: Placement) {
    const s = store.sealById(p.sealId);
    if (!s) return null;
    const geom = getSealGeometry(s);
    const ink = maybeMirror(geom.ink, s);
    const m = matMultiply(
      matTranslate(p.xMm, p.yMm),
      matMultiply(matRotate(p.rotDeg), matScale(p.scale, p.scale))
    );
    // 印面中心对齐到 (xMm,yMm):先平移 -w/2,-h/2
    const m2 = matMultiply(m, matTranslate(-s.widthMm / 2, -s.heightMm / 2));
    return mpTransform(ink, m2);
  }

  function draw() {
    const ctx = setupCanvas(canvas);
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    const sheet = store.sheet;

    // 纸
    const o = mmToPx(view, { x: 0, y: 0 });
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(o.x, o.y, sheet.wMm * view.pxPerMm, sheet.hMm * view.pxPerMm);
    ctx.restore();

    // 印(叠盖:multiply 混合,后钤的压先钤的)
    for (const p of store.placements) {
      const poly = placementPoly(p);
      if (!poly) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = p.opacity;
      fillMultiPoly(ctx, poly, view, p.ink);
      ctx.restore();
    }

    // 吸附参考线
    ctx.save();
    ctx.strokeStyle = '#2f6fdd';
    ctx.setLineDash([4, 4]);
    if (snapLines.v !== undefined) {
      const x = mmToPx(view, { x: snapLines.v, y: 0 }).x;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke();
    }
    if (snapLines.h !== undefined) {
      const y = mmToPx(view, { x: 0, y: snapLines.h }).y;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke();
    }
    ctx.restore();

    // 选中框 + 十字定位
    const sel = store.placements.find((p) => p.id === selectedId);
    if (sel) {
      const s = store.sealById(sel.sealId);
      if (s) {
        const c = mmToPx(view, { x: sel.xMm, y: sel.yMm });
        const w = s.widthMm * sel.scale * view.pxPerMm;
        const h = s.heightMm * sel.scale * view.pxPerMm;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((sel.rotDeg * Math.PI) / 180);
        ctx.strokeStyle = '#2f6fdd';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.restore();
      }
      if (showCross) drawCrosshair(ctx, view, { x: sel.xMm, y: sel.yMm }, r.width, r.height);
    }
  }

  function syncPanel() {
    const sheet = store.sheet;
    $<HTMLInputElement>('#sheetW').value = String(sheet.wMm);
    $<HTMLInputElement>('#sheetH').value = String(sheet.hMm);
    $<HTMLSelectElement>('#sealPick').innerHTML = store.seals
      .map((s) => `<option value="${s.id}">${s.name}(${s.widthMm}×${s.heightMm}mm)</option>`)
      .join('');

    const host = $('#placeList');
    host.innerHTML = '';
    store.placements.forEach((p, i) => {
      const s = store.sealById(p.sealId);
      const div = document.createElement('div');
      div.className = 'row';
      div.style.cursor = 'pointer';
      if (p.id === selectedId) div.style.background = '#e8dfc8';
      div.innerHTML = `<span class="chip" style="background:${p.ink};color:#fff">${i + 1}</span>
        <span style="flex:1">${s?.name ?? '?'} @ ${round1(p.xMm)},${round1(p.yMm)}</span>`;
      div.addEventListener('click', () => {
        selectedId = p.id;
        syncPanel();
        draw();
      });
      host.appendChild(div);
    });

    const sel = store.placements.find((p) => p.id === selectedId);
    $('#noSel').style.display = sel ? 'none' : '';
    $('#selCtrls').style.display = sel ? '' : 'none';
    if (sel) {
      const s = store.sealById(sel.sealId);
      $<HTMLInputElement>('#pX').value = String(round1(sel.xMm));
      $<HTMLInputElement>('#pY').value = String(round1(sel.yMm));
      $<HTMLInputElement>('#pRot').value = String(round1(sel.rotDeg));
      $<HTMLInputElement>('#pSize').value = s ? String(round1(s.widthMm * sel.scale)) : '';
      $<HTMLSelectElement>('#pInk').value = sel.ink;
      $<HTMLInputElement>('#pAlpha').value = String(Math.round(sel.opacity * 100));
      $('#pAlphaV').textContent = `${Math.round(sel.opacity * 100)}%`;
    }
    $('#crossBtn').classList.toggle('active', showCross);
  }

  // ---------- 交互 ----------
  type Drag = { kind: 'move'; id: string; startMm: Pt; startX: number; startY: number } | { kind: 'pan'; startPx: Pt; ox: number; oy: number };
  let drag: Drag | null = null;

  function eventPx(e: PointerEvent | WheelEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitPlacement(mm: Pt): Placement | null {
    // 从后往前(后钤的在上)
    for (let i = store.placements.length - 1; i >= 0; i--) {
      const p = store.placements[i];
      const s = store.sealById(p.sealId);
      if (!s) continue;
      const hw = (s.widthMm * p.scale) / 2;
      const hh = (s.heightMm * p.scale) / 2;
      // 逆旋转后判矩形
      const dx = mm.x - p.xMm;
      const dy = mm.y - p.yMm;
      const rad = (-p.rotDeg * Math.PI) / 180;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return p;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const px = eventPx(e);
    const mm = pxToMm(view, px);
    const hit = hitPlacement(mm);
    if (hit) {
      selectedId = hit.id;
      drag = { kind: 'move', id: hit.id, startMm: mm, startX: hit.xMm, startY: hit.yMm };
      syncPanel();
      draw();
    } else {
      drag = { kind: 'pan', startPx: px, ox: view.oxMm, oy: view.oyMm };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const px = eventPx(e);
    const mm = pxToMm(view, px);
    if (drag.kind === 'pan') {
      view.oxMm = drag.ox - (px.x - drag.startPx.x) / view.pxPerMm;
      view.oyMm = drag.oy - (px.y - drag.startPx.y) / view.pxPerMm;
      draw();
      return;
    }
    const p = store.placements.find((x) => x.id === (drag as { id: string }).id);
    if (!p) return;
    let nx = round1(drag.startX + (mm.x - drag.startMm.x));
    let ny = round1(drag.startY + (mm.y - drag.startMm.y));
    // 中心吸附(0.5mm)
    snapLines = {};
    for (const q of store.placements) {
      if (q.id === p.id) continue;
      if (Math.abs(q.xMm - nx) < 0.5) {
        nx = q.xMm;
        snapLines.v = q.xMm;
      }
      if (Math.abs(q.yMm - ny) < 0.5) {
        ny = q.yMm;
        snapLines.h = q.yMm;
      }
    }
    store.update(() => {
      p.xMm = nx;
      p.yMm = ny;
    });
  });

  canvas.addEventListener('pointerup', () => {
    drag = null;
    snapLines = {};
    syncPanel();
    draw();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = eventPx(e);
    const before = pxToMm(view, px);
    view.pxPerMm = clamp(view.pxPerMm * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 50);
    const after = pxToMm(view, px);
    view.oxMm += before.x - after.x;
    view.oyMm += before.y - after.y;
    draw();
  }, { passive: false });

  // ---------- 面板 ----------
  $('#sheetPreset').addEventListener('change', (e) => {
    const i = parseInt((e.target as HTMLSelectElement).value);
    store.setSheet(SHEET_PRESETS[i]);
    fit();
    draw();
  });
  $('#sheetW').addEventListener('change', (e) =>
    store.setSheet({ ...store.sheet, wMm: Math.max(50, parseFloat((e.target as HTMLInputElement).value) || 210) })
  );
  $('#sheetH').addEventListener('change', (e) =>
    store.setSheet({ ...store.sheet, hMm: Math.max(50, parseFloat((e.target as HTMLInputElement).value) || 297) })
  );

  $('#addPlacement').addEventListener('click', () => {
    const sealId = $<HTMLSelectElement>('#sealPick').value;
    const s = store.sealById(sealId);
    if (!s) return;
    const sheet = store.sheet;
    const n = store.placements.length;
    store.update(() => {
      store.placements.push({
        id: store.uid(),
        sealId,
        xMm: round1(sheet.wMm / 2 + (n % 3) * (s.widthMm + 5)),
        yMm: round1(sheet.hMm - 40 - Math.floor(n / 3) * (s.heightMm + 8)),
        rotDeg: 0,
        scale: 1,
        ink: INK_COLORS[0].value,
        opacity: 0.92,
      });
    });
    selectedId = store.placements[store.placements.length - 1]?.id ?? null;
  });

  const selPlacement = () => store.placements.find((p) => p.id === selectedId);
  const bindNum = (id: string, fn: (p: Placement, v: number) => void) => {
    $(id).addEventListener('change', (e) => {
      const p = selPlacement();
      if (!p) return;
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (isNaN(v)) return;
      store.update(() => fn(p, v));
    });
  };
  bindNum('#pX', (p, v) => (p.xMm = round1(v)));
  bindNum('#pY', (p, v) => (p.yMm = round1(v)));
  bindNum('#pRot', (p, v) => (p.rotDeg = round1(v)));
  bindNum('#pSize', (p, v) => {
    const s = store.sealById(p.sealId);
    if (s && v > 0) p.scale = Math.round((v / s.widthMm) * 1000) / 1000;
  });
  $('#pInk').addEventListener('change', (e) => {
    const p = selPlacement();
    if (p) store.update(() => (p.ink = (e.target as HTMLSelectElement).value));
  });
  $('#pAlpha').addEventListener('input', (e) => {
    const p = selPlacement();
    if (p) store.update(() => (p.opacity = parseInt((e.target as HTMLInputElement).value) / 100));
  });
  $('#pDup').addEventListener('click', () => {
    const p = selPlacement();
    if (!p) return;
    const s = store.sealById(p.sealId);
    store.update(() => {
      store.placements.push({ ...p, id: store.uid(), xMm: round1(p.xMm + (s ? s.widthMm * p.scale + 5 : 30)) });
    });
    selectedId = store.placements[store.placements.length - 1]?.id ?? null;
  });
  $('#pDel').addEventListener('click', () => {
    store.update(() => {
      const i = store.placements.findIndex((p) => p.id === selectedId);
      if (i >= 0) store.placements.splice(i, 1);
    });
    selectedId = null;
  });
  $('#crossBtn').addEventListener('click', () => {
    showCross = !showCross;
    syncPanel();
    draw();
  });

  const unsub = store.subscribe(() => {
    syncPanel();
    draw();
  });
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  syncPanel();
  fit();
  draw();

  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
  };
}
