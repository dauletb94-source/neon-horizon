// Minimal self-contained QR Code generator (byte mode, ECC level L, versions 1-10, auto mask).
// API: NH_QR.encode(text) -> { size, get(x,y) }   NH_QR.draw(ctx, text, x, y, size, fg, bg, quiet)
(function (global) {
  const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];   // ECC codewords per block, level L
  const NBLK = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];            // number of blocks, level L
  const EXP = [], LOG = [];
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } })();
  const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
  const bit = (v, i) => ((v >>> i) & 1) === 1;

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const dataCapacity = (v) => Math.floor(rawModules(v) / 8) - ECC[v - 1] * NBLK[v - 1];

  function rsGen(deg) {
    let r = [1];
    for (let i = 0; i < deg; i++) {
      const n = new Array(r.length + 1).fill(0);
      for (let j = 0; j < r.length; j++) { n[j] ^= r[j]; n[j + 1] ^= mul(r[j], EXP[i]); }
      r = n;
    }
    return r;
  }
  function rsEncode(data, deg) {
    const gen = rsGen(deg), res = new Array(deg).fill(0);
    for (const b of data) {
      const f = b ^ res.shift(); res.push(0);
      if (f) for (let i = 0; i < deg; i++) res[i] ^= mul(gen[i + 1], f);
    }
    return res;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 1;
    for (; v <= 10; v++) { const cc = v <= 9 ? 8 : 16; if (4 + cc + 8 * bytes.length <= dataCapacity(v) * 8) break; }
    if (v > 10) throw new Error("QR: text too long");
    // bit stream
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, v <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    const cap = dataCapacity(v) * 8;
    push(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // blocks + interleave
    const nb = NBLK[v - 1], el = ECC[v - 1], total = Math.floor(rawModules(v) / 8);
    const numShort = nb - (total % nb), shortLen = Math.floor(total / nb);
    const dBlocks = [], eBlocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, k + shortLen - el + (i < numShort ? 0 : 1)); k += d.length;
      dBlocks.push(d); eBlocks.push(rsEncode(d, el));
    }
    const all = [];
    const maxD = shortLen - el + 1;
    for (let i = 0; i < maxD; i++) for (const d of dBlocks) if (i < d.length) all.push(d[i]);
    for (let i = 0; i < el; i++) for (const e of eBlocks) all.push(e[i]);

    // matrix
    const size = v * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, d) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = d; fn[y][x] = true; } };
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setF(cx + dx, cy + dy, d !== 2 && d !== 4); } };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (v > 1) {
      const na = Math.floor(v / 7) + 2;
      const step = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const drawFormat = (mask) => {
      const d = (1 << 3) | mask; let rem = d;          // ECC L = 01
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits15 = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(bits15, i));
      setF(8, 7, bit(bits15, 6)); setF(8, 8, bit(bits15, 7)); setF(7, 8, bit(bits15, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(bits15, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(bits15, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(bits15, i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits18 = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const c = bit(bits18, i), a = size - 11 + (i % 3), b = Math.floor(i / 3); setF(a, b, c); setF(b, a, c); }
    }
    // data placement
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && idx < all.length * 8) { m[y][x] = bit(all[idx >>> 3], 7 - (idx & 7)); idx++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const applyMask = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => {
      let p = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1;
          for (let b = 1; b < size; b++) { if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
          // finder-like 1011101 with 4 light on either side
          for (let b = 0; b + 7 <= size; b++) {
            if (get(a, b) && !get(a, b + 1) && get(a, b + 2) && get(a, b + 3) && get(a, b + 4) && !get(a, b + 5) && get(a, b + 6)) {
              const l = (s, e) => { for (let i = s; i < e; i++) if (i >= 0 && i < size && get(a, i)) return false; return true; };
              if (l(b - 4, b) || l(b + 7, b + 11)) p += 40;
            }
          }
        }
      };
      line((a, b) => m[a][b]); line((a, b) => m[b][a]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      let dark = 0; for (const r of m) for (const c of r) if (c) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) { applyMask(k); drawFormat(k); const p = penalty(); if (p < bestP) { bestP = p; best = k; } applyMask(k); }
    applyMask(best); drawFormat(best);
    return { size, version: v, get: (x, y) => m[y][x] };
  }

  function draw(ctx, text, x0, y0, px, fg, bg, quiet = 4) {
    const q = encode(text), cell = px / (q.size + quiet * 2);
    ctx.fillStyle = bg; ctx.fillRect(x0, y0, px, px);
    ctx.fillStyle = fg;
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) {
      ctx.fillRect(Math.floor(x0 + (x + quiet) * cell), Math.floor(y0 + (y + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
  function toSvg(text, px = 180, fg = "#04131a", bg = "#fff") {
    const q = encode(text), n = q.size + 8;
    let d = "";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
  }
  global.NH_QR = { encode, draw, toSvg };
})(window);
