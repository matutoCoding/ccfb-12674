/**
 * 章法模板页:一字到多字的排法图鉴(顺读/回文等),选中自动套用到当前印稿。
 */
import { store } from '../core/store';
import { TEMPLATES, LayoutTemplate } from '../core/templates';

function drawTemplatePreview(cv: HTMLCanvasElement, tpl: LayoutTemplate) {
  const ctx = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f4ea';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b8271a';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  const pad = 14;
  const gap = 6;
  const cw = (W - pad * 2 - (tpl.cols - 1) * gap) / tpl.cols;
  const ch = (H - pad * 2 - (tpl.rows - 1) * gap) / tpl.rows;

  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  tpl.cells.forEach(([col, row], i) => {
    const x = pad + col * (cw + gap);
    const y = pad + row * (ch + gap);
    ctx.fillStyle = 'rgba(200,50,30,0.12)';
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = 'rgba(200,50,30,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cw, ch);
    ctx.fillStyle = '#8c2f1b';
    ctx.fillText(String(i + 1), x + cw / 2, y + ch / 2);
  });
}

export function mountTemplates(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="scroll-col">
      <div class="toolbar-strip">
        <b>章法模板</b>
        <span class="hint">数字为读序。点「套用」把当前印稿按此章法重排。</span>
      </div>
      <div class="tpl-grid" id="grid"></div>
    </div>`;

  const grid = root.querySelector('#grid')!;
  for (const tpl of TEMPLATES) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    const cv = document.createElement('canvas');
    cv.width = 110;
    cv.height = 110;
    drawTemplatePreview(cv, tpl);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = tpl.name;
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = tpl.desc;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.style.marginTop = '6px';
    btn.textContent = '套用到当前印稿';
    btn.addEventListener('click', () => {
      const s = store.currentSeal();
      if (!s) return;
      const n = [...s.text].length;
      if (tpl.cells.length !== n) {
        if (!confirm(`当前印文 ${n} 字,模板「${tpl.name}」为 ${tpl.cells.length} 字,仍要套用吗?`)) return;
      }
      store.mutate(() => {
        s.templateId = tpl.id;
        s.transforms = {};
      });
      location.hash = '#/design';
    });
    card.append(cv, name, desc, btn);
    grid.appendChild(card);
  }

  return () => {};
}
