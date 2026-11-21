/** 确定性伪随机数(mulberry32):同一个种子每次生成完全一致的序列,残破效果可复现。 */

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

export function rngInt(rng: Rng, lo: number, hi: number): number {
  return Math.floor(rngRange(rng, lo, hi + 1));
}
