/**
 * 章法模板:定义格子数与字的落格顺序(读序)。
 * col 从 0(左)起,row 从 0(上)起;cells[i] 是第 i 个字的格子。
 */

export interface LayoutTemplate {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** cells[i] = [col, row],按印文顺序 */
  cells: [number, number][];
  desc: string;
}

/** 纵列顺读:右列起,自上而下,自右而左 */
function columnsRtl(cols: number, rows: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let c = cols - 1; c >= 0; c--) for (let r = 0; r < rows; r++) cells.push([c, r]);
  return cells;
}

/** 横排顺读:右起,自右而左(单行) */
function rowRtl(cols: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let c = cols - 1; c >= 0; c--) cells.push([c, 0]);
  return cells;
}

export const TEMPLATES: LayoutTemplate[] = [
  { id: 't1', name: '一字印', cols: 1, rows: 1, cells: [[0, 0]], desc: '单字满布' },
  { id: 't2h', name: '二字·横列', cols: 2, rows: 1, cells: rowRtl(2), desc: '右起读' },
  { id: 't2v', name: '二字·纵列', cols: 1, rows: 2, cells: [[0, 0], [0, 1]], desc: '自上而下' },
  { id: 't3v', name: '三字·纵列', cols: 1, rows: 3, cells: [[0, 0], [0, 1], [0, 2]], desc: '自上而下' },
  { id: 't3r', name: '三字·右一左二', cols: 2, rows: 2, cells: [[1, 0], [0, 0], [0, 1]], desc: '右列一字,左列二字' },
  { id: 't4s', name: '四字·顺读', cols: 2, rows: 2, cells: columnsRtl(2, 2), desc: '右上→右下→左上→左下' },
  { id: 't4h', name: '四字·回文读', cols: 2, rows: 2, cells: [[1, 0], [0, 0], [0, 1], [1, 1]], desc: '右上→左上→左下→右下,顺时针回环' },
  { id: 't5', name: '五字·右三左二', cols: 2, rows: 3, cells: [[1, 0], [1, 1], [1, 2], [0, 0], [0, 1]], desc: '右列三字,左列二字' },
  { id: 't6', name: '六字·两列', cols: 2, rows: 3, cells: columnsRtl(2, 3), desc: '右列起顺读' },
  { id: 't8', name: '八字·两列', cols: 2, rows: 4, cells: columnsRtl(2, 4), desc: '右列起顺读' },
  { id: 't9', name: '九字·三列', cols: 3, rows: 3, cells: columnsRtl(3, 3), desc: '右列起顺读' },
  { id: 't12', name: '十二字·三列', cols: 3, rows: 4, cells: columnsRtl(3, 4), desc: '右列起顺读' },
];

export function getTemplate(id: string): LayoutTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

/** 按字数挑一个最合适的默认模板 */
export function defaultTemplateFor(n: number): LayoutTemplate {
  const exact = TEMPLATES.filter((t) => t.cells.length === n);
  if (exact.length > 0) return exact[0];
  // 超出内置模板:自动多列(每列最多 4 字)
  const rows = Math.min(4, n);
  const cols = Math.ceil(n / rows);
  return { id: 'auto', name: `自动${cols}列`, cols, rows, cells: columnsRtl(cols, rows).slice(0, n), desc: '自动排布' };
}
