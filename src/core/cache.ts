/** 印面几何缓存:按 store.revision 失效,避免每次重绘都重算布尔运算。 */
import { Seal, SealGeometry, computeSealGeometry, GlyphResolver } from './seal';
import { store } from './store';

let cacheRev = -1;
const cache = new Map<string, SealGeometry>();

export function getSealGeometry(seal: Seal): SealGeometry {
  if (cacheRev !== store.revision) {
    cache.clear();
    cacheRev = store.revision;
  }
  let g = cache.get(seal.id);
  if (!g) {
    g = computeSealGeometry(seal, store.resolveGlyph);
    cache.set(seal.id, g);
  }
  return g;
}
