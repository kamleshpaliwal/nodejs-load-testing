export function createRandom(seed) {
  let state = typeof seed === 'number' ? (seed >>> 0) : [...String(seed)].reduce((a,c)=>Math.imul(a ^ c.charCodeAt(0),16777619),2166136261) >>> 0;
  state ||= 0x6d2b79f5;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function makeItem(seed, index, namespace='loadtest') {
  const rand = createRandom(`${seed}:${index}`);
  return { name: `${namespace}-${index}-${Math.floor(rand()*1e9).toString(36)}`, value: Math.floor(rand()*100000), index };
}
