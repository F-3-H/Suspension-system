/* ============================================================
 * fft.js —— 基-2 快速傅里叶变换、逆变换、Welch 功率谱估计
 * 傅里叶的思想：任何（随机）实数函数都可由许多频率函数叠加而成。
 * ============================================================ */
(function (global) {
  'use strict';

  /** 原地基-2 FFT，re/im 长度必须为 2 的幂 */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cwr = 1, cwi = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const vr = re[b] * cwr - im[b] * cwi;
          const vi = re[b] * cwi + im[b] * cwr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
          const nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr; cwr = nwr;
        }
      }
    }
  }

  /** 原地逆 FFT：IDFT(X) = conj(FFT(conj(X))) / N */
  function ifft(re, im) {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
  }

  function hann(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }

  /**
   * Welch 法单边功率谱密度估计。
   * @returns {{f:Float64Array, P:Float64Array}}
   */
  function welch(x, fs, seg, overlap) {
    seg = seg || 512;
    overlap = overlap == null ? 0.5 : overlap;
    const step = Math.max(1, Math.floor(seg * (1 - overlap)));
    const win = hann(seg);
    let winPow = 0;
    for (let i = 0; i < seg; i++) winPow += win[i] * win[i];
    const half = seg >> 1;
    const acc = new Float64Array(half + 1);
    let count = 0;
    for (let start = 0; start + seg <= x.length; start += step) {
      let mean = 0;
      for (let i = 0; i < seg; i++) mean += x[start + i];
      mean /= seg;
      const re = new Float64Array(seg), im = new Float64Array(seg);
      for (let i = 0; i < seg; i++) re[i] = (x[start + i] - mean) * win[i];
      fft(re, im);
      for (let k = 0; k <= half; k++) {
        let p = (re[k] * re[k] + im[k] * im[k]) / (fs * winPow);
        if (k > 0 && k < half) p *= 2; // 单边谱
        acc[k] += p;
      }
      count++;
    }
    const P = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) P[k] = count ? acc[k] / count : 0;
    const f = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) f[k] = k * fs / seg;
    return { f: f, P: P };
  }

  /** 对离散序列做 FFT，返回复数谱（用于频域合成/计算） */
  function spectrum(re, im) {
    const r = Float64Array.from(re), i = Float64Array.from(im);
    fft(r, i);
    return { re: r, im: i };
  }

  global.FFT = { fft: fft, ifft: ifft, welch: welch, hann: hann, spectrum: spectrum };
})(window);
