// 動態星空背景：閃爍星星 + 流星。
// 效能設計：
//   - 約 70% 的星星預先畫在離屏畫布，每幀只貼一次圖
//   - 只有約 30% 的星星做閃爍運算
//   - 最高 30 FPS；分頁隱藏時暫停；prefers-reduced-motion 或使用者關閉時只畫靜態一幀

const FPS = 30;
const STAR_DENSITY = 1 / 5200; // 每像素星星數
const MAX_STARS = 420;

export function createStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1;
  let staticLayer = null;
  let twinkles = [];
  let meteors = [];
  let nextMeteor = 0;
  let raf = 0, last = 0;
  let enabled = true;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function starColor() {
    const r = Math.random();
    if (r < 0.12) return [180, 200, 255];
    if (r < 0.2) return [255, 230, 200];
    if (r < 0.26) return [210, 190, 255];
    return [255, 255, 255];
  }

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = Math.max(window.innerWidth, 1); h = Math.max(window.innerHeight, 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(MAX_STARS, Math.round(w * h * STAR_DENSITY));
    staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width; staticLayer.height = canvas.height;
    const sctx = staticLayer.getContext('2d');
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    twinkles = [];
    for (let i = 0; i < count; i++) {
      const star = {
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() < 0.9 ? rand(0.3, 0.9) : rand(0.9, 1.6),
        a: rand(0.25, 0.9), c: starColor(),
        speed: rand(0.6, 2.2), phase: rand(0, Math.PI * 2),
      };
      if (Math.random() < 0.3) twinkles.push(star);
      else drawStar(sctx, star, star.a);
    }
  }

  function drawStar(c, s, alpha) {
    c.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${alpha})`;
    if (s.r < 0.8) c.fillRect(s.x, s.y, s.r * 1.6, s.r * 1.6);
    else {
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
      if (s.r > 1.2) {
        c.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${alpha * 0.15})`;
        c.beginPath(); c.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2); c.fill();
      }
    }
  }

  function spawnMeteor(now) {
    const fromLeft = Math.random() < 0.5;
    const angle = rand(0.35, 0.65) * (fromLeft ? 1 : -1);
    const speed = rand(700, 1100);
    meteors.push({
      x: fromLeft ? rand(-0.1, 0.6) * w : rand(0.4, 1.1) * w,
      y: rand(-0.05, 0.35) * h,
      vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed,
      len: rand(120, 220), born: now, life: rand(700, 1200),
    });
    nextMeteor = now + rand(2500, 7000);
  }

  function frame(now, animate) {
    if (!staticLayer?.width || !staticLayer?.height) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(staticLayer, 0, 0, w, h);
    const t = now / 1000;
    for (const s of twinkles) {
      const a = animate ? s.a * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase)) : s.a;
      drawStar(ctx, s, a);
    }
    if (!animate) return;
    if (now > nextMeteor) spawnMeteor(now);
    meteors = meteors.filter((m) => now - m.born < m.life);
    for (const m of meteors) {
      const age = (now - m.born) / 1000;
      const p = (now - m.born) / m.life;
      const x = m.x + m.vx * age, y = m.y + m.vy * age;
      const norm = Math.hypot(m.vx, m.vy);
      const tx = x - (m.vx / norm) * m.len, ty = y - (m.vy / norm) * m.len;
      const alpha = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      const g = ctx.createLinearGradient(x, y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
      g.addColorStop(0.3, `rgba(170,200,255,${0.4 * alpha})`);
      g.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now;
    frame(now, true);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (enabled && !reduced && !document.hidden) {
      nextMeteor = performance.now() + 1500;
      raf = requestAnimationFrame(loop);
    } else {
      frame(performance.now(), false);
    }
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { build(); start(); }, 150);
  });
  document.addEventListener('visibilitychange', start);

  build();
  start();

  return {
    get enabled() { return enabled; },
    get reduced() { return reduced; },
    setEnabled(v) { enabled = v; meteors = []; start(); },
  };
}
