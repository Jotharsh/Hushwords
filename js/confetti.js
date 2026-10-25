// A short burst of paper confetti on a canvas that removes itself.
export function confetti(colors, ms = 3600) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti'; c.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.append(c);
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const W = innerWidth, H = innerHeight;
  const bits = Array.from({ length: 150 }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    return { x: W / 2 + side * W * 0.1, y: H * 0.82, vx: side * (2 + Math.random() * 7) * (Math.random() > 0.3 ? 1 : -0.6), vy: -(10 + Math.random() * 13), w: 6 + Math.random() * 8, h: 9 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[i % colors.length] };
  });
  const t0 = performance.now();
  (function frame(now) {
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.34; b.vx *= 0.992; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.globalAlpha = Math.max(0, 1 - Math.max(0, t - ms * 0.6) / (ms * 0.4));
      g.fillStyle = b.col; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 1.6)) + 2); g.restore();
    }
    if (t < ms) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
