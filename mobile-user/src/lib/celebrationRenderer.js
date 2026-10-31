// Copied from frontend/src/utils/celebrationRenderer.js (drawing logic unchanged). It draws into the
// canvas-compatible recorder in src/components/Celebration.jsx, which renders the frame as SVG.
import { particleCount, effectLayers, INTENSITY, MAX_PARTICLES } from '../shared/celebration';
// One bounded Canvas 2D loop per mounted header layer. No DOM particles or dependencies.
// The canvas is sized to its container; nothing here can draw outside that box.
// Combined presets share the canvas and the loop; each keeps its own particles.
const BURST_LIFE = 1.4, MAX_BURSTS = 3;
// Custom animation shapes, filled around the origin with radius r.
function drawShape(ctx, custom, r) {
  if (custom.shape === 'emoji') { ctx.font = `${Math.round(r * 2.4)}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(custom.emoji, 0, 0); return; }
  ctx.beginPath();
  if (custom.shape === 'square') ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
  else if (custom.shape === 'diamond') { ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0); ctx.closePath(); }
  else if (custom.shape === 'petal') ctx.ellipse(0, 0, r, r / 2, 0.6, 0, Math.PI * 2);
  else if (custom.shape === 'star') { for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, d = i % 2 ? r * 0.45 : r; i ? ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d) : ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); } ctx.closePath(); }
  else if (custom.shape === 'heart') { ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.6, -r * 1.1, 0, -r * 0.35); ctx.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.4, -r * 0.1, 0, r * 0.9); }
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}
export function startCelebration(canvas, effect, env = window, { still = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let frame = 0, previous = 0, elapsed = 0, width = 0, height = 0, stopped = false, visible = !env.IntersectionObserver;
  const doc = canvas.ownerDocument;
  const layer = config => {
    let nextBurst = 0;
    const count = particleCount(config), scale = config.size || 1, drift = { left: -1, right: 1 }[config.direction] || 0;
    const pick = () => config.colors[Math.floor(Math.random() * config.colors.length)];
    const custom = config.custom, bursting = config.preset === 'fireworks' || custom?.motion === 'burst';
    const particles = bursting ? [] : Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), size: (2 + Math.random() * 5) * scale, phase: Math.random() * Math.PI * 2, color: pick() }));
    // At most three bursts are alive, and their sparks never exceed MAX_PARTICLES.
    const sparks = Math.max(8, Math.min(Math.floor(MAX_PARTICLES / MAX_BURSTS), Math.round(count / 2)));
    const bursts = [];
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
      // Sky lanterns rise from below the bottom edge, drift out of the top and start
      // again from the bottom, each on its own staggered cycle. They fade in and out
      // near the edges; the canvas clips anything beyond its box.
      const lanterns = width < 500 ? 3 : 5, reach = 21 * scale, travel = height + 2 * reach;
      const body = config.colors[1] || config.colors[0], trim = config.colors[2] || body;
      for (let i = 0; i < lanterns; i++) {
        const t = elapsed * config.speed, flicker = 1 + Math.sin(elapsed * 9 + i * 2) * 0.12;
        const progress = (t * 32 / travel + i * 0.618) % 1, fade = Math.min(1, progress / 0.15, (1 - progress) / 0.15);
        const x = (i + 0.5) / lanterns * width + Math.sin(t * 0.7 + i * 2.1) * 10 * scale, y = height + reach - progress * travel;
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.1 + i) * 0.08);
        ctx.fillStyle = config.colors[0]; ctx.globalAlpha = config.opacity * 0.3 * flicker * fade;
        ctx.beginPath(); ctx.ellipse(0, 0, 16 * scale, 18 * scale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = Math.min(1, config.opacity + 0.3) * fade;
        ctx.fillStyle = trim; ctx.fillRect(-5 * scale, -13 * scale, 10 * scale, 3 * scale); ctx.fillRect(-4 * scale, 10 * scale, 8 * scale, 2.5 * scale);
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, 9 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = trim; ctx.lineWidth = Math.max(0.5, 0.8 * scale); ctx.beginPath(); ctx.ellipse(0, 0, 4.5 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = config.colors[0]; ctx.globalAlpha = Math.min(1, config.opacity + 0.3) * (0.75 + 0.25 * flicker) * fade;
        ctx.beginPath(); ctx.ellipse(0, scale, 4 * scale, 6 * scale * flicker, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = trim; ctx.beginPath(); ctx.moveTo(0, 12.5 * scale); ctx.lineTo(0, 20 * scale); ctx.stroke();
        ctx.restore();
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
        for (const s of f.sparks) {
          const x = f.x + s.vx * f.age, y = f.y + s.vy * f.age + 18 * f.age * f.age;
          if (custom) { ctx.save(); ctx.translate(x, y); drawShape(ctx, custom, 2.6 * scale); ctx.restore(); }
          else { ctx.beginPath(); ctx.arc(x, y, 1.6 * scale, 0, Math.PI * 2); ctx.fill(); }
        }
      }
    };
    // Falling and rising wrap inside the box; twinkling stays put and pulses.
    const moving = dt => {
      const direction = custom.motion === 'rise' ? -1 : 1;
      for (const p of particles) {
        const r = p.size;
        p.phase += dt * config.speed;
        let x, y, alpha = config.opacity;
        if (custom.motion === 'twinkle') {
          const pulse = Math.abs(Math.sin(p.phase * 1.5));
          x = r + p.x * Math.max(0, width - 2 * r); y = r + p.y * Math.max(0, height - 2 * r); alpha *= 0.2 + pulse * 0.8;
        } else {
          p.y = (p.y + direction * dt * config.speed * 45 / height + 1) % 1;
          p.x = (p.x + dt * config.speed * drift * 18 / width + 1) % 1;
          x = p.x * width + Math.sin(p.phase) * 15; y = p.y * height;
        }
        ctx.save(); ctx.translate(x, y);
        if (custom.motion !== 'twinkle' && custom.shape !== 'emoji') ctx.rotate(p.phase);
        ctx.fillStyle = p.color; ctx.globalAlpha = alpha; drawShape(ctx, custom, r); ctx.restore();
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
    return bursting ? fireworks : custom ? moving : config.preset === 'lights' ? lights : falling;
  };
  const layers = effectLayers(effect).map(layer);
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(env.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (still) paint(0);
  };
  function paint(dt) {
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    for (const draw of layers) { ctx.save(); draw(dt); ctx.restore(); }
  }
  const draw = time => {
    frame = 0;
    if (stopped || doc.hidden || !visible) return;
    const delta = previous ? Math.max(0, (time - previous) / 1000) : 0;
    const dt = Math.min(delta, 0.05); previous = time; elapsed += delta;
    if (effect.duration && elapsed >= effect.duration) { ctx.clearRect(0, 0, width, height); stopped = true; return; }
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
