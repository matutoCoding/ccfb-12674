/**
 * 篆字库页:浏览内置小篆与自定义字形;缺字可拼偏旁组合,或导入字形图自动描摹成矢量。
 */
import { store } from '../core/store';
import { BUILTIN_GLYPHS, COMPONENTS } from '../core/glyphData';
import { GlyphData, StrokeGlyph, glyphToPoly } from '../core/glyph';
import { traceImage } from '../core/trace';
import { MultiPoly, strokeToPoly, mpUnionAll } from '../core/polygon';
import { Pt } from '../core/geom';

type ComposeLayout = 'lr' | 'lmr' | 'tb' | 'tmb';

const LAYOUTS: Record<ComposeLayout, { name: string; slots: [number, number, number, number][] }> = {
  lr: { name: '左右', slots: [[0, 0, 40, 100], [42, 0, 58, 100]] },
  lmr: { name: '左中右', slots: [[0, 0, 32, 100], [34, 0, 32, 100], [68, 0, 32, 100]] },
  tb: { name: '上下', slots: [[0, 0, 100, 46], [0, 50, 100, 50]] },
  tmb: { name: '上中下', slots: [[0, 0, 100, 32], [0, 34, 100, 32], [0, 68, 100, 32]] },
};

/** 把部件按槽位缩放平移,拼成一个新字形 */
function composeGlyph(layout: ComposeLayout, compNames: string[]): StrokeGlyph | null {
  const slots = LAYOUTS[layout].slots;
  if (compNames.length !== slots.length || compNames.some((n) => !COMPONENTS[n])) return null;
  const strokes: StrokeGlyph['strokes'] = [];
  compNames.forEach((name, i) => {
    const [sx, sy, sw, sh] = slots[i];
    const comp = COMPONENTS[name];
    for (const st of comp.strokes) {
      strokes.push({
        pts: st.pts.map((p) => ({ x: sx + (p.x / 100) * sw, y: sy + (p.y / 100) * sh })),
        w: st.w * Math.min(sw, sh) / 100 + 2,
      });
    }
  });
  return { kind: 'stroke', strokes };
}

export function mountGlyphs(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel left" style="width:300px">
      <h3>查字</h3>
      <div class="row"><label>输入字</label><input type="text" id="q" placeholder="输入简体字"></div>
      <div id="lookupResult" class="hint"></div>
      <h3>拼偏旁组字</h3>
      <div class="row"><label>结构</label><select id="layout">
        ${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}
      </select></div>
      <div id="slotHosts"></div>
      <div class="row"><label>存为字</label><input type="text" id="composeChar" maxlength="1" placeholder="如:江"></div>
      <div class="btn-row"><button id="composeSave" class="primary">保存为篆字</button></div>
      <h3>导入字形图</h3>
      <div class="row"><input type="file" id="imgFile" accept="image/*"></div>
      <div class="row"><label>阈值</label><input type="range" id="threshold" min="60" max="220" value="140"><span class="val" id="thresholdV">140</span></div>
      <div class="row"><label>存为字</label><input type="text" id="importChar" maxlength="1"></div>
      <div class="btn-row"><button id="importSave" class="primary" disabled>描摹并保存</button></div>
      <div class="hint">导入黑底白字或白底黑字的字形照片/截图,自动描成矢量轮廓。</div>
    </div>
    <div class="scroll-col">
      <div class="toolbar-strip">
        <b>拼字/导入预览</b>
        <span class="hint">预览为矢量轮廓,保存后全库可用</span>
      </div>
      <div style="display:flex;gap:16px;padding:12px;align-items:flex-start;flex-wrap:wrap">
        <canvas id="previewCv" width="180" height="180" style="background:#f8f4ea;border:1px solid var(--panel-border);border-radius:6px"></canvas>
        <div id="previewInfo" class="hint" style="max-width:300px">选择部件或导入图片后在此预览。</div>
      </div>
      <div class="toolbar-strip"><b>字库</b><span class="hint" id="glyphCount"></span></div>
      <div class="glyph-grid" id="glyphGrid"></div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const previewCv = $<HTMLCanvasElement>('#previewCv');
  const pctx = previewCv.getContext('2d')!;
  let imported: MultiPoly | null = null;
  let importedImg: ImageData | null = null;

  const compNames = Object.keys(COMPONENTS);

  function slotCount(): number {
    return LAYOUTS[$<HTMLSelectElement>('#layout').value as ComposeLayout].slots.length;
  }

  function renderSlotHosts() {
    const host = $('#slotHosts');
    host.innerHTML = '';
    const n = slotCount();
    const layoutKey = $<HTMLSelectElement>('#layout').value;
    const names =
      layoutKey === 'lr' ? ['左', '右']
      : layoutKey === 'lmr' ? ['左', '中', '右']
      : layoutKey === 'tb' ? ['上', '下']
      : ['上', '中', '下'];
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<label>${names[i]}</label><select data-slot="${i}">
        ${compNames.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>`;
      host.appendChild(row);
      row.querySelector('select')!.addEventListener('change', updateComposePreview);
    }
  }

  function currentCompose(): { glyph: StrokeGlyph; ch: string } | null {
    const layout = $<HTMLSelectElement>('#layout').value as ComposeLayout;
    const picks = [...root.querySelectorAll<HTMLSelectElement>('#slotHosts select')].map((s) => s.value);
    const glyph = composeGlyph(layout, picks);
    const ch = $<HTMLInputElement>('#composeChar').value.trim();
    return glyph ? { glyph, ch } : null;
  }

  function drawPreview(mp: MultiPoly | null, note: string) {
    pctx.clearRect(0, 0, 180, 180);
    pctx.fillStyle = '#f8f4ea';
    pctx.fillRect(0, 0, 180, 180);
    pctx.strokeStyle = '#d8d0c0';
    pctx.strokeRect(8, 8, 164, 164);
    if (mp) {
      const path = new Path2D();
      const s = 164 / 100;
      for (const poly of mp)
        for (const ring of poly) {
          if (!ring.length) continue;
          path.moveTo(8 + ring[0].x * s, 8 + ring[0].y * s);
          for (let i = 1; i < ring.length; i++) path.lineTo(8 + ring[i].x * s, 8 + ring[i].y * s);
          path.closePath();
        }
      pctx.fillStyle = '#b8271a';
      pctx.fill(path, 'evenodd');
    }
    $('#previewInfo').textContent = note;
  }

  function updateComposePreview() {
    const c = currentCompose();
    if (!c) return;
    imported = null;
    $<HTMLButtonElement>('#importSave').disabled = true;
    drawPreview(mpUnionAll(c.glyph.strokes.map((s) => strokeToPoly(s.pts, s.w))), `拼字预览:${c.ch ? `存为「${c.ch}」` : '请填写要保存的字'}`);
  }

  function renderGrid(filter = '') {
    const grid = $('#glyphGrid');
    grid.innerHTML = '';
    const custom = store.customGlyphs;
    const all: { ch: string; g: GlyphData; custom: boolean }[] = [
      ...Object.keys(BUILTIN_GLYPHS).map((ch) => ({ ch, g: BUILTIN_GLYPHS[ch] as GlyphData, custom: false })),
      ...Object.entries(custom).map(([ch, g]) => ({ ch, g, custom: true })),
    ];
    const shown = filter ? all.filter((x) => x.ch.includes(filter)) : all;
    $('#glyphCount').textContent = `内置 ${Object.keys(BUILTIN_GLYPHS).length} 字 · 自定义 ${Object.keys(custom).length} 字`;
    for (const { ch, g, custom: isCustom } of shown) {
      const cell = document.createElement('div');
      cell.className = 'glyph-cell' + (isCustom ? ' custom' : '');
      const cv = document.createElement('canvas');
      cv.width = 52;
      cv.height = 52;
      const c2 = cv.getContext('2d')!;
      const mp = glyphToPoly(g);
      const path = new Path2D();
      const s = 48 / 100;
      for (const poly of mp)
        for (const ring of poly) {
          if (!ring.length) continue;
          path.moveTo(2 + ring[0].x * s, 2 + ring[0].y * s);
          for (let i = 1; i < ring.length; i++) path.lineTo(2 + ring[i].x * s, 2 + ring[i].y * s);
          path.closePath();
        }
      c2.fillStyle = '#b8271a';
      c2.fill(path, 'evenodd');
      const label = document.createElement('div');
      label.className = 'ch';
      label.textContent = ch + (isCustom ? ' ✎' : '');
      cell.append(cv, label);
      cell.title = isCustom ? '自定义字形,点击可删除' : '内置字形';
      if (isCustom) {
        cell.addEventListener('click', () => {
          if (confirm(`删除自定义字「${ch}」?(将回退到内置字形或缺字)`)) store.deleteCustomGlyph(ch);
        });
      }
      grid.appendChild(cell);
    }
  }

  // 查字
  $('#q').addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.trim();
    renderGrid(v);
    if (!v) {
      $('#lookupResult').innerHTML = '';
      return;
    }
    const parts = [...v].map((ch) => {
      const has = !!store.resolveGlyph(ch);
      return has ? `<span>${ch} ✓</span>` : `<span class="missing-char">${ch} ✗缺字</span>`;
    });
    $('#lookupResult').innerHTML = parts.join(' · ');
  });

  $('#layout').addEventListener('change', () => {
    renderSlotHosts();
    updateComposePreview();
  });

  $('#composeChar').addEventListener('input', updateComposePreview);

  $('#composeSave').addEventListener('click', () => {
    const c = currentCompose();
    if (!c || !c.ch) {
      alert('请先填写要保存的字');
      return;
    }
    store.setCustomGlyph(c.ch, c.glyph);
    alert(`已保存「${c.ch}」的篆字,印稿中可直接使用`);
  });

  // 导入描摹
  $('#imgFile').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const max = 400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      const c2 = cv.getContext('2d')!;
      c2.drawImage(img, 0, 0, cv.width, cv.height);
      importedImg = c2.getImageData(0, 0, cv.width, cv.height);
      runTrace();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });

  function runTrace() {
    if (!importedImg) return;
    const th = parseInt($<HTMLInputElement>('#threshold').value);
    imported = traceImage(importedImg, th);
    $<HTMLButtonElement>('#importSave').disabled = imported.length === 0;
    drawPreview(imported, imported.length ? `描摹成功:${imported.length} 个外轮廓` : '未识别到墨迹,调阈值试试');
  }

  $('#threshold').addEventListener('input', (e) => {
    $('#thresholdV').textContent = (e.target as HTMLInputElement).value;
    runTrace();
  });

  $('#importSave').addEventListener('click', () => {
    const ch = $<HTMLInputElement>('#importChar').value.trim();
    if (!ch || !imported) {
      alert('请填写要保存的字');
      return;
    }
    store.setCustomGlyph(ch, { kind: 'poly', poly: imported });
    alert(`已保存「${ch}」的描摹字形`);
  });

  const unsub = store.subscribe(() => renderGrid($<HTMLInputElement>('#q').value.trim()));

  renderSlotHosts();
  updateComposePreview();
  renderGrid();

  return () => unsub();
}
