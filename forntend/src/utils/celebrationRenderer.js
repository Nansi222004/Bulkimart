import { particleCount, INTENSITY, MAX_PARTICLES } from '../../../backend/shared/celebration.mjs';
// One bounded Canvas 2D loop per mounted header layer. No DOM particles or dependencies.
// The canvas is sized to its container; nothing here can draw outside that box.
const BURST_LIFE = 1.4, MAX_BURSTS = 3;
export function startCelebration(canvas, config, env = window, { still = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let frame = 0, previous = 0, elapsed = 0, width = 0, height = 0, stopped = false, visible = !env.IntersectionObserver, nextBurst = 0;
  const doc = canvas.ownerDocument, count = particleCount(config), scale = config.size || 1, drift = { left: -1, right: 1 }[config.direction] || 0;
  const pick = () => config.colors[Math.floor(Math.random() * config.colors.length)];
  const particles = config.preset === 'fireworks' ? [] : Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), size: (2 + Math.random() * 5) * scale, phase: Math.random() * Math.PI * 2, color: pick() }));
  // At most three bursts are alive, and their sparks never exceed MAX_PARTICLES.
  const sparks = Math.max(8, Math.min(Math.floor(MAX_PARTICLES / MAX_BURSTS), Math.round(count / 2)));
  const bursts = [];
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(env.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still) paint(0);
  };
  const burst = () => {
    // Size scales the burst, but its reach and centre keep every spark inside the header.
    const box = Math.min(width, height), reach = Math.min(box * 0.4, box * (0.22 + Math.random() * 0.12) * scale), color = pick();
    const fall = 18 * BURST_LIFE * BURST_LIFE, span = (from, to) => from + Math.random() * Math.max(0, to - from);
    bursts.push({ x: span(reach, width - reach), y: span(reach, height - reach - fall), age: still ? BURST_LIFE * 0.35 : 0, color,
      sparks: Array.from({ length: sparks }, (_, i) => { const angle = i / sparks * Math.PI * 2, speed = reach / BURST_LIFE * (0.6 + Math.random() * 0.4); return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed }; }) });
    if (bursts.length > MAX_BURSTS) bursts.shift();
  };
  const lights = dt => {
    const bulbs = Math.min(particles.length, Math.max(4, Math.floor(width / 16))), strands = Math.max(1, Math.round(width / 160)), sag = Math.min(18, height * 0.12);
    const wireY = x => 6 + sag * Math.sin(Math.PI * ((x / width * strands) % 1));
    ctx.globalAlpha = config.opacity * 0.6; ctx.strokeStyle = config.colors[0]; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= width; x += 8) x ? ctx.lineTo(x, wireY(x)) : ctx.moveTo(0, wireY(0));
    ctx.stroke();
    for (let i = 0; i < bulbs; i++) {
      const p = particles[i], x = (i + 0.5) / bulbs * width, y = wireY(x) + 5 * scale, r = 2.5 * scale;
      p.phase += dt * config.speed * 2;
      const glow = 0.45 + Math.abs(Math.sin(p.phase)) * 0.55;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = config.opacity * glow * 0.25; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = config.opacity * glow; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Small diyas sit on the bottom edge; their flames flicker gently.
    const diyas = width < 500 ? 3 : 5;
    for (let i = 0; i < diyas; i++) {
      const x = (i + 0.5) / diyas * width, y = height - 10 * scale, flicker = 1 + Math.sin(elapsed * 9 + i) * 0.12;
      ctx.globalAlpha = Math.min(1, config.opacity + 0.2); ctx.fillStyle = config.colors[1] || config.colors[0];
      ctx.beginPath(); ctx.ellipse(x, y, 13 * scale, 8 * scale, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = config.colors[0]; ctx.beginPath(); ctx.ellipse(x, y - 6 * scale * flicker, 3.2 * scale, 7 * scale * flicker, 0, 0, Math.PI * 2); ctx.fill();
    }
  };
  const fireworks = dt => {
    nextBurst -= dt;
    if (nextBurst <= 0 && !still) { burst(); nextBurst = 1.6 / (INTENSITY[config.intensity] || 1) / config.speed; }
    if (still && !bursts.length) burst();
    for (let b = bursts.length - 1; b >= 0; b--) {
      const f = bursts[b]; f.age += dt;
      if (f.age >= BURST_LIFE) { bursts.splice(b, 1); continue; }
      ctx.fillStyle = f.color; ctx.globalAlpha = config.opacity * (1 - f.age / BURST_LIFE);
      for (const s of f.sparks) { ctx.beginPath(); ctx.arc(f.x + s.vx * f.age, f.y + s.vy * f.age + 18 * f.age * f.age, 1.6 * scale, 0, Math.PI * 2); ctx.fill(); }
    }
  };
  const falling = dt => {
    for (const p of particles) {
      p.y = (p.y + dt * config.speed * 45 / height) % 1;
      p.x = (p.x + dt * config.speed * drift * 18 / width + 1) % 1;
      p.phase += dt * config.speed;
      ctx.save(); ctx.translate(p.x * width + Math.sin(p.phase) * 15, p.y * height);
      ctx.rotate(p.phase); ctx.fillStyle = p.color; ctx.globalAlpha = config.opacity;
      ctx.beginPath();
      if (config.preset === 'snowfall') ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      else if (config.preset === 'petals') ctx.ellipse(0, 0, p.size, p.size / 2, 0.6, 0, Math.PI * 2);
      else if (config.preset === 'sparkles') {
        ctx.globalAlpha *= 0.4 + Math.abs(Math.sin(p.phase)) * 0.6;
        ctx.moveTo(0, -p.size); ctx.lineTo(p.size / 3, -p.size / 3); ctx.lineTo(p.size, 0); ctx.lineTo(p.size / 3, p.size / 3); ctx.lineTo(0, p.size); ctx.lineTo(-p.size / 3, p.size / 3); ctx.lineTo(-p.size, 0); ctx.lineTo(-p.size / 3, -p.size / 3); ctx.closePath();
      } else ctx.rect(-p.size / 2, -p.size / 2, p.size, p.size / 2);
      ctx.fill(); ctx.restore();
    }
  };
  function paint(dt) {
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    ctx.save();
    if (config.preset === 'lights') lights(dt); else if (config.preset === 'fireworks') fireworks(dt); else falling(dt);
    ctx.restore();
  }
  const draw = time => {
    frame = 0;
    if (stopped || doc.hidden || !visible) return;
    const delta = previous ? Math.max(0, (time - previous) / 1000) : 0;
    const dt = Math.min(delta, 0.05); previous = time; elapsed += delta;
    if (config.duration && elapsed >= config.duration) { ctx.clearRect(0, 0, width, height); stopped = true; return; }
    paint(dt);
    frame = env.requestAnimationFrame(draw);
  };
  const visibility = () => { env.cancelAnimationFrame(frame); frame = 0; previous = 0; if (!still && !doc.hidden && visible && !stopped) frame = env.requestAnimationFrame(draw); };
  const intersection = env.IntersectionObserver && !still ? new env.IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); }) : null;
  intersection?.observe(canvas);
  const observer = env.ResizeObserver ? new env.ResizeObserver(resize) : null;
  observer?.observe(canvas); env.addEventListener('resize', resize); doc.addEventListener('visibilitychange', visibility);
  resize(); visibility();
  return () => { stopped = true; env.cancelAnimationFrame(frame); observer?.disconnect(); intersection?.disconnect(); env.removeEventListener('resize', resize); doc.removeEventListener('visibilitychange', visibility); ctx.clearRect(0, 0, width, height); };
}
