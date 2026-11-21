/**
 * 应用状态与本地持久化(localStorage)。素材与作品全部留在本机。
 */
import { Seal, createSeal, SealStatus } from './seal';
import { GlyphData } from './glyph';
import { lookupBuiltin } from './glyphData';

export interface Order {
  id: string;
  client: string;
  note: string;
  createdAt: number;
}

export interface Placement {
  id: string;
  sealId: string;
  xMm: number; // 印面中心在幅面上的位置
  yMm: number;
  rotDeg: number;
  scale: number; // 1 = 原大
  ink: string; // 印泥色
  opacity: number; // 0-1
}

export interface Sheet {
  wMm: number;
  hMm: number;
  name: string;
}

export const SHEET_PRESETS: Sheet[] = [
  { name: '斗方 68×68cm', wMm: 680, hMm: 680 },
  { name: '四尺三开 46×69cm', wMm: 460, hMm: 690 },
  { name: '四尺对开 34.5×138cm', wMm: 345, hMm: 1380 },
  { name: '扇面 60×30cm', wMm: 600, hMm: 300 },
  { name: '名片小帧 15×10cm', wMm: 150, hMm: 100 },
  { name: 'A4 21×29.7cm', wMm: 210, hMm: 297 },
];

export const INK_COLORS = [
  { name: '朱砂', value: '#c8321e' },
  { name: '朱磦', value: '#d94f2b' },
  { name: '大红', value: '#b71c1c' },
  { name: '赭石', value: '#8d4a2b' },
  { name: '墨色', value: '#2b2b2b' },
  { name: '靛蓝', value: '#1f3a6e' },
];

interface DB {
  seals: Seal[];
  orders: Order[];
  customGlyphs: Record<string, GlyphData>;
  placements: Placement[];
  sheet: Sheet;
  worksView: 'list' | 'card';
  currentSealId: string | null;
}

const KEY = 'seal-studio.v1';

function defaultDB(): DB {
  return {
    seals: [],
    orders: [],
    customGlyphs: {},
    placements: [],
    sheet: SHEET_PRESETS[5],
    worksView: 'card',
    currentSealId: null,
  };
}

class Store {
  db: DB = defaultDB();
  /** 几何缓存失效计数:任何影响印面轮廓的修改都 bump */
  revision = 0;
  private listeners = new Set<() => void>();

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DB>;
        this.db = { ...defaultDB(), ...parsed };
      }
    } catch {
      this.db = defaultDB();
    }
    if (this.db.seals.length === 0) {
      // 首次使用:放一方示例印
      const demo = createSeal(this.uid());
      demo.name = '示例·吉祥';
      demo.text = '吉祥';
      this.db.seals.push(demo);
      this.db.currentSealId = demo.id;
      this.save();
    }
    if (!this.db.currentSealId && this.db.seals.length > 0) {
      this.db.currentSealId = this.db.seals[0].id;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch {
      /* 存储满时静默失败,不丢内存状态 */
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  /** 修改并持久化(不触发几何重算) */
  update(fn: () => void) {
    fn();
    this.save();
    this.emit();
  }

  /** 修改并使几何缓存失效(印面轮廓相关) */
  mutate(fn: () => void) {
    fn();
    this.revision++;
    this.save();
    this.emit();
  }

  uid(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ---- 印稿 ----
  get seals(): Seal[] {
    return this.db.seals;
  }

  currentSeal(): Seal | null {
    return this.db.seals.find((s) => s.id === this.db.currentSealId) ?? this.db.seals[0] ?? null;
  }

  setCurrentSeal(id: string) {
    this.update(() => {
      this.db.currentSealId = id;
    });
  }

  addSeal(seal: Seal) {
    this.mutate(() => {
      this.db.seals.push(seal);
      this.db.currentSealId = seal.id;
    });
  }

  deleteSeal(id: string) {
    this.mutate(() => {
      this.db.seals = this.db.seals.filter((s) => s.id !== id);
      this.db.placements = this.db.placements.filter((p) => p.sealId !== id);
      if (this.db.currentSealId === id) this.db.currentSealId = this.db.seals[0]?.id ?? null;
    });
  }

  sealById(id: string): Seal | null {
    return this.db.seals.find((s) => s.id === id) ?? null;
  }

  // ---- 委托单 ----
  get orders(): Order[] {
    return this.db.orders;
  }

  addOrder(client: string, note: string): Order {
    const o: Order = { id: this.uid(), client, note, createdAt: Date.now() };
    this.update(() => {
      this.db.orders.push(o);
    });
    return o;
  }

  deleteOrder(id: string) {
    this.update(() => {
      this.db.orders = this.db.orders.filter((o) => o.id !== id);
      for (const s of this.db.seals) if (s.orderId === id) s.orderId = null;
    });
  }

  orderById(id: string | null): Order | null {
    return this.db.orders.find((o) => o.id === id) ?? null;
  }

  // ---- 字形 ----
  resolveGlyph = (ch: string): GlyphData | null => {
    return this.db.customGlyphs[ch] ?? lookupBuiltin(ch);
  };

  setCustomGlyph(ch: string, g: GlyphData) {
    this.mutate(() => {
      this.db.customGlyphs[ch] = g;
    });
  }

  deleteCustomGlyph(ch: string) {
    this.mutate(() => {
      delete this.db.customGlyphs[ch];
    });
  }

  get customGlyphs(): Record<string, GlyphData> {
    return this.db.customGlyphs;
  }

  // ---- 钤印预览 ----
  get placements(): Placement[] {
    return this.db.placements;
  }

  get sheet(): Sheet {
    return this.db.sheet;
  }

  setSheet(s: Sheet) {
    this.update(() => {
      this.db.sheet = s;
    });
  }
}

export const store = new Store();

export const STATUS_LABEL: Record<SealStatus, string> = {
  pending: '待确认',
  carved: '已刻制',
  delivered: '已交付',
};
