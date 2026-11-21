/**
 * 作品管理页:委托单分组、三档状态、客户/日期筛选排序、列表卡片双视图、按月交付统计。
 */
import { store, STATUS_LABEL } from '../core/store';
import { Seal, SealStatus, createSeal } from '../core/seal';
import { getSealGeometry } from '../core/cache';
import { maybeMirror } from '../core/seal';
import { MultiPoly } from '../core/polygon';
import { mpBBox } from '../core/polygon';

type SortKey = 'updated' | 'name' | 'status';

function drawSealThumb(cv: HTMLCanvasElement, seal: Seal) {
  const ctx = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f4ea';
  ctx.fillRect(0, 0, W, H);
  const geom = getSealGeometry(seal);
  const ink: MultiPoly = maybeMirror(geom.ink, seal);
  const bb = mpBBox(ink) ?? { minX: 0, minY: 0, maxX: seal.widthMm, maxY: seal.heightMm };
  const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 1);
  const s = (Math.min(W, H) - 16) / span;
  const ox = (W - (bb.maxX - bb.minX) * s) / 2 - bb.minX * s;
  const oy = (H - (bb.maxY - bb.minY) * s) / 2 - bb.minY * s;
  const path = new Path2D();
  for (const poly of ink)
    for (const ring of poly) {
      if (!ring.length) continue;
      path.moveTo(ox + ring[0].x * s, oy + ring[0].y * s);
      for (let i = 1; i < ring.length; i++) path.lineTo(ox + ring[i].x * s, oy + ring[i].y * s);
      path.closePath();
    }
  ctx.fillStyle = '#b8271a';
  ctx.fill(path, 'evenodd');
}

function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mountWorks(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel left" style="width:240px">
      <h3>委托单</h3>
      <div id="orderList"></div>
      <div class="row"><input type="text" id="newClient" placeholder="客户姓名"></div>
      <div class="row"><input type="text" id="newNote" placeholder="备注(可空)"></div>
      <div class="btn-row"><button id="addOrder" class="primary">＋新建委托单</button></div>
      <h3>交付统计(按月)</h3>
      <canvas id="statCv" width="210" height="150" style="background:#fff;border:1px solid var(--panel-border);border-radius:6px"></canvas>
      <div id="statText" class="hint"></div>
    </div>
    <div class="scroll-col">
      <div class="toolbar-strip">
        <input type="text" id="fClient" placeholder="按客户筛选" style="width:120px">
        <label class="hint">从</label><input type="date" id="fFrom">
        <label class="hint">到</label><input type="date" id="fTo">
        <select id="fStatus">
          <option value="">全部状态</option>
          <option value="pending">待确认</option>
          <option value="carved">已刻制</option>
          <option value="delivered">已交付</option>
        </select>
        <select id="sortBy">
          <option value="updated">按更新时间</option>
          <option value="name">按名称</option>
          <option value="status">按状态</option>
        </select>
        <span class="sep"></span>
        <button id="viewList">列表</button>
        <button id="viewCard">卡片</button>
        <span class="sep"></span>
        <button id="newSealBtn" class="primary">＋新建印稿</button>
      </div>
      <div class="stat-bar" id="summary"></div>
      <div id="worksHost"></div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  let filterOrderId: string | null = null;

  function filteredSeals(): Seal[] {
    const client = $<HTMLInputElement>('#fClient').value.trim().toLowerCase();
    const from = $<HTMLInputElement>('#fFrom').value ? new Date($<HTMLInputElement>('#fFrom').value).getTime() : null;
    const to = $<HTMLInputElement>('#fTo').value ? new Date($<HTMLInputElement>('#fTo').value).getTime() + 86400000 : null;
    const st = $<HTMLSelectElement>('#fStatus').value;
    const sortBy = $<HTMLSelectElement>('#sortBy').value as SortKey;

    let list = store.seals.filter((s) => {
      if (filterOrderId && s.orderId !== filterOrderId) return false;
      if (st && s.status !== st) return false;
      const o = store.orderById(s.orderId);
      if (client && !(o?.client.toLowerCase().includes(client) || s.name.toLowerCase().includes(client))) return false;
      if (from && s.updatedAt < from) return false;
      if (to && s.updatedAt > to) return false;
      return true;
    });
    const statusRank: Record<SealStatus, number> = { pending: 0, carved: 1, delivered: 2 };
    list = list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh');
      if (sortBy === 'status') return statusRank[a.status] - statusRank[b.status];
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  function renderOrders() {
    const host = $('#orderList');
    host.innerHTML = '';
    const mk = (id: string | null, label: string, count: number) => {
      const div = document.createElement('div');
      div.className = 'row';
      div.style.cursor = 'pointer';
      if (filterOrderId === id) div.style.background = '#e8dfc8';
      div.innerHTML = `<span style="flex:1">${label}</span><span class="chip">${count}</span>`;
      div.addEventListener('click', () => {
        filterOrderId = id;
        renderAll();
      });
      host.appendChild(div);
    };
    mk(null, '全部', store.seals.length);
    for (const o of store.orders) {
      const div = document.createElement('div');
      div.className = 'row';
      div.style.cursor = 'pointer';
      if (filterOrderId === o.id) div.style.background = '#e8dfc8';
      const n = store.seals.filter((s) => s.orderId === o.id).length;
      div.innerHTML = `<span style="flex:1"><b>${o.client}</b> <span class="hint">${fmtDate(o.createdAt)}</span></span>
        <span class="chip">${n}</span><button class="danger" title="删除委托单">×</button>`;
      div.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') {
          if (confirm(`删除委托单「${o.client}」?其中印稿会移出委托单。`)) store.deleteOrder(o.id);
          return;
        }
        filterOrderId = o.id;
        renderAll();
      });
      host.appendChild(div);
    }
  }

  function renderStats() {
    const cv = $<HTMLCanvasElement>('#statCv');
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 按月统计已交付
    const byMonth = new Map<string, number>();
    for (const s of store.seals) {
      if (s.status !== 'delivered') continue;
      const d = new Date(s.deliveredAt ?? s.updatedAt);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(k, (byMonth.get(k) ?? 0) + 1);
    }
    const months = [...byMonth.keys()].sort();
    const recent = months.slice(-8);
    const max = Math.max(1, ...recent.map((m) => byMonth.get(m)!));
    const bw = (cv.width - 30) / Math.max(1, recent.length);
    ctx.fillStyle = '#8c2f1b';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    recent.forEach((m, i) => {
      const v = byMonth.get(m)!;
      const h = (v / max) * (cv.height - 40);
      const x = 20 + i * bw;
      ctx.fillRect(x + 3, cv.height - 22 - h, bw - 6, h);
      ctx.fillStyle = '#2e2a24';
      ctx.fillText(m.slice(2), x + bw / 2, cv.height - 10);
      ctx.fillText(String(v), x + bw / 2, cv.height - 26 - h);
      ctx.fillStyle = '#8c2f1b';
    });
    const total = store.seals.filter((s) => s.status === 'delivered').length;
    $('#statText').textContent = recent.length ? `累计交付 ${total} 方` : '暂无交付记录';
  }

  function statusChip(s: Seal): string {
    return `<span class="chip st-${s.status}">${STATUS_LABEL[s.status]}</span>`;
  }

  function bindStatusSelect(el: HTMLSelectElement, seal: Seal) {
    el.value = seal.status;
    el.addEventListener('change', () => {
      store.update(() => {
        seal.status = el.value as SealStatus;
        seal.updatedAt = Date.now();
        if (seal.status === 'delivered' && !seal.deliveredAt) seal.deliveredAt = Date.now();
        if (seal.status !== 'delivered') seal.deliveredAt = null;
      });
    });
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  function orderOptions(sel: string | null): string {
    return (
      `<option value="">未归单</option>` +
      store.orders.map((o) => `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${o.client}</option>`).join('')
    );
  }

  function renderList(list: Seal[]) {
    const host = $('#worksHost');
    host.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'list';
    table.innerHTML = `<thead><tr>
      <th>印稿</th><th>印文</th><th>尺寸</th><th>委托单</th><th>状态</th><th>交付日</th><th>更新</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const s of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${s.name}</b></td>
        <td>${s.text}</td>
        <td>${s.widthMm}×${s.heightMm}mm</td>
        <td><select data-k="order">${orderOptions(s.orderId)}</select></td>
        <td><select data-k="status">
          <option value="pending">待确认</option><option value="carved">已刻制</option><option value="delivered">已交付</option>
        </select></td>
        <td>${fmtDate(s.deliveredAt)}</td>
        <td class="hint">${fmtDate(s.updatedAt)}</td>
        <td><button data-k="open">打开</button></td>`;
      bindStatusSelect(tr.querySelector('[data-k="status"]') as HTMLSelectElement, s);
      const orderSel = tr.querySelector('[data-k="order"]') as HTMLSelectElement;
      orderSel.addEventListener('change', () => store.update(() => (s.orderId = orderSel.value || null)));
      (tr.querySelector('[data-k="open"]') as HTMLButtonElement).addEventListener('click', () => {
        store.setCurrentSeal(s.id);
        location.hash = '#/design';
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderCards(list: Seal[]) {
    const host = $('#worksHost');
    host.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'cards';
    for (const s of list) {
      const card = document.createElement('div');
      card.className = 'card';
      const cv = document.createElement('canvas');
      cv.width = 200;
      cv.height = 200;
      drawSealThumb(cv, s);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const o = store.orderById(s.orderId);
      meta.innerHTML = `<b>${s.name}</b> ${statusChip(s)}<br>
        ${s.text} · ${s.widthMm}×${s.heightMm}mm · ${s.style === 'zhu' ? '朱文' : '白文'}<br>
        ${o ? `委托:${o.client}` : '未归单'} · 更新 ${fmtDate(s.updatedAt)}`;
      const row = document.createElement('div');
      row.className = 'btn-row';
      row.style.marginTop = '6px';
      const stSel = document.createElement('select');
      stSel.innerHTML = `<option value="pending">待确认</option><option value="carved">已刻制</option><option value="delivered">已交付</option>`;
      bindStatusSelect(stSel, s);
      const openBtn = document.createElement('button');
      openBtn.textContent = '打开';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.setCurrentSeal(s.id);
        location.hash = '#/design';
      });
      row.append(stSel, openBtn);
      card.append(cv, meta, row);
      card.addEventListener('click', () => {
        store.setCurrentSeal(s.id);
        location.hash = '#/design';
      });
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }

  function renderSummary(list: Seal[]) {
    const n = (st: SealStatus) => list.filter((s) => s.status === st).length;
    $('#summary').innerHTML = `
      <span>共 <b>${list.length}</b> 方</span>
      <span>待确认 <b>${n('pending')}</b></span>
      <span>已刻制 <b>${n('carved')}</b></span>
      <span>已交付 <b>${n('delivered')}</b></span>`;
  }

  function renderAll() {
    renderOrders();
    renderStats();
    const list = filteredSeals();
    renderSummary(list);
    const mode = store.db.worksView;
    $('#viewList').classList.toggle('active', mode === 'list');
    $('#viewCard').classList.toggle('active', mode === 'card');
    if (mode === 'list') renderList(list);
    else renderCards(list);
  }

  // 事件
  $('#addOrder').addEventListener('click', () => {
    const client = $<HTMLInputElement>('#newClient').value.trim();
    if (!client) return;
    store.addOrder(client, $<HTMLInputElement>('#newNote').value.trim());
    $<HTMLInputElement>('#newClient').value = '';
    $<HTMLInputElement>('#newNote').value = '';
  });
  for (const id of ['#fClient', '#fFrom', '#fTo', '#fStatus', '#sortBy']) {
    $(id).addEventListener('input', renderAll);
  }
  $('#viewList').addEventListener('click', () => store.update(() => (store.db.worksView = 'list')));
  $('#viewCard').addEventListener('click', () => store.update(() => (store.db.worksView = 'card')));
  $('#newSealBtn').addEventListener('click', () => {
    const s = createSeal(store.uid());
    s.name = `印稿 ${store.seals.length + 1}`;
    s.orderId = filterOrderId;
    store.addSeal(s);
    location.hash = '#/design';
  });

  const unsub = store.subscribe(renderAll);
  renderAll();
  return () => unsub();
}
