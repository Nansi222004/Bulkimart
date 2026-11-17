import { particleCount, effectLayers, INTENSITY, MAX_PARTICLES } from '../../../backend/shared/celebration.mjs';
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
    const diyas = dt => {
      const diyaCount = Math.min(particles.length, Math.max(3, Math.floor(width / 75)));
      const baseColor = config.colors[3] || config.colors[2] || '#8B2500';
      const flameColor = config.colors[1] || '#FF7A00';
      const glowColor = config.colors[0] || '#FFD700';
      const rimColor = config.colors[2] || '#D97706';

      for (let i = 0; i < diyaCount; i++) {
        const p = particles[i] || { phase: i };
        p.phase += dt * config.speed * 2.5;
        const x = ((i + 0.5) / diyaCount) * width;
        const y = height - 16 * scale;
        const flicker = Math.sin(p.phase * 2.5 + elapsed * 5) * 0.15;
        const pulse = 0.85 + flicker;
        const flameH = (14 + Math.sin(p.phase * 3) * 3) * scale;
        const tipX = Math.sin(p.phase * 2.2) * 2 * scale;

        ctx.save();
        ctx.translate(x, y);

        // 1. Soft glowing aura around flame
        ctx.fillStyle = glowColor;
        ctx.globalAlpha = config.opacity * 0.35 * pulse;
        ctx.beginPath();
        ctx.arc(0, -flameH * 0.5, 16 * scale * pulse, 0, Math.PI * 2);
        ctx.fill();

        // 2. Earthen diya lamp bowl
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = config.opacity * 0.95;
        ctx.beginPath();
        ctx.moveTo(-15 * scale, 0);
        ctx.bezierCurveTo(-14 * scale, 10 * scale, 14 * scale, 10 * scale, 15 * scale, 0);
        ctx.bezierCurveTo(8 * scale, -2 * scale, -8 * scale, -2 * scale, -15 * scale, 0);
        ctx.closePath();
        ctx.fill();

        // Diya rim highlight
        ctx.fillStyle = rimColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, 13 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();

        // 3. Looping flickering flame / jot
        // Outer flame (saffron / orange)
        ctx.fillStyle = flameColor;
        ctx.globalAlpha = Math.min(1, config.opacity + 0.35) * pulse;
        ctx.beginPath();
        ctx.moveTo(-5 * scale, -1 * scale);
        ctx.bezierCurveTo(-7 * scale, -flameH * 0.5, tipX - 2 * scale, -flameH * 0.8, tipX, -flameH);
        ctx.bezierCurveTo(tipX + 2 * scale, -flameH * 0.8, 7 * scale, -flameH * 0.5, 5 * scale, -1 * scale);
        ctx.closePath();
        ctx.fill();

        // Inner flame core (bright golden / white hot core)
        ctx.fillStyle = '#FFFDF0';
        ctx.globalAlpha = Math.min(1, config.opacity + 0.45);
        ctx.beginPath();
        ctx.moveTo(-2 * scale, -1 * scale);
        ctx.bezierCurveTo(-3 * scale, -flameH * 0.35, tipX * 0.5 - 1 * scale, -flameH * 0.6, tipX * 0.5, -flameH * 0.68);
        ctx.bezierCurveTo(tipX * 0.5 + 1 * scale, -flameH * 0.6, 3 * scale, -flameH * 0.35, 2 * scale, -1 * scale);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      // Gentle rising golden embers from the diyas
      const emberCount = Math.min(particles.length, 16);
      for (let j = 0; j < emberCount; j++) {
        const p = particles[j];
        p.y = (p.y - dt * config.speed * 22 / height + 1) % 1;
        p.x = (p.x + Math.sin(p.phase + elapsed * 1.5) * 0.003 + 1) % 1;
        p.phase += dt * config.speed * 2;
        const ex = p.x * width;
        const ey = p.y * height;
        ctx.fillStyle = glowColor;
        ctx.globalAlpha = config.opacity * (0.3 + Math.abs(Math.sin(p.phase)) * 0.5);
        ctx.beginPath();
        ctx.arc(ex, ey, (1.2 + (j % 3) * 0.5) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const candles = dt => {
      const count = Math.min(particles.length, Math.max(3, Math.floor(width / 70)));
      const bodyColor = config.colors[2] || config.colors[0];
      const flameColor = config.colors[1] || '#FF922B';
      const glowColor = config.colors[0] || '#FFE066';

      for (let i = 0; i < count; i++) {
        const p = particles[i] || { phase: i };
        p.phase += dt * config.speed * 2.5;
        const x = ((i + 0.5) / count) * width;
        const candleH = (18 + (i % 3) * 6) * scale;
        const y = height - candleH;
        const flicker = Math.sin(p.phase * 3 + elapsed * 4) * 0.15;
        const pulse = 0.85 + flicker;
        const flameH = (12 + Math.sin(p.phase * 3.5) * 2) * scale;

        ctx.save();
        ctx.translate(x, y);

        // Candle stick body
        ctx.fillStyle = bodyColor;
        ctx.globalAlpha = config.opacity * 0.9;
        ctx.beginPath();
        ctx.rect(-5 * scale, 0, 10 * scale, candleH);
        ctx.fill();

        // Wick
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -4 * scale);
        ctx.stroke();

        // Candle flame glow
        ctx.fillStyle = glowColor;
        ctx.globalAlpha = config.opacity * 0.3 * pulse;
        ctx.beginPath();
        ctx.arc(0, -8 * scale, 14 * scale * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Flame
        ctx.fillStyle = flameColor;
        ctx.globalAlpha = Math.min(1, config.opacity + 0.3) * pulse;
        ctx.beginPath();
        ctx.ellipse(0, -8 * scale, 3 * scale, flameH * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright core
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = Math.min(1, config.opacity + 0.4);
        ctx.beginPath();
        ctx.ellipse(0, -6 * scale, 1.2 * scale, flameH * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    };
    // ---- Christmas ----
    const color = (i, fallback) => config.colors[i] || fallback;
    // Six-armed crystals with side branches, drifting and turning slowly.
    const snowflakes = dt => {
      ctx.lineWidth = Math.max(0.8, scale); ctx.globalAlpha = config.opacity;
      for (const p of particles) {
        p.y = (p.y + dt * config.speed * 30 / height) % 1;
        p.x = (p.x + dt * config.speed * drift * 18 / width + 1) % 1;
        p.phase += dt * config.speed * 0.6;
        const r = p.size * 1.4, b = r * 0.32;
        ctx.save(); ctx.translate(p.x * width + Math.sin(p.phase) * 12, p.y * height); ctx.rotate(p.phase);
        ctx.strokeStyle = p.color; ctx.beginPath();
        for (let a = 0; a < 6; a++) {
          const angle = a * Math.PI / 3, cx = Math.cos(angle), cy = Math.sin(angle), bx = cx * r * 0.6, by = cy * r * 0.6;
          ctx.moveTo(0, 0); ctx.lineTo(cx * r, cy * r);
          ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(angle + 0.8) * b, by + Math.sin(angle + 0.8) * b);
          ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(angle - 0.8) * b, by + Math.sin(angle - 0.8) * b);
        }
        ctx.stroke(); ctx.restore();
      }
    };
    // Wrapped presents with a ribbon and bow, swaying as they fall. Half the quantity: boxes are large.
    const gifts = dt => {
      const shown = particles.slice(0, Math.max(3, Math.ceil(particles.length / 2)));
      shown.forEach((p, i) => {
        p.y = (p.y + dt * config.speed * 35 / height) % 1;
        p.x = (p.x + dt * config.speed * drift * 18 / width + 1) % 1;
        p.phase += dt * config.speed;
        const w = p.size * 1.3 + 3 * scale, box = p.color;
        const ribbon = config.colors.length > 1 ? config.colors[(config.colors.indexOf(box) + 2) % config.colors.length] : '#FFFFFF';
        ctx.save(); ctx.translate(p.x * width + Math.sin(p.phase) * 10, p.y * (height + 4 * w) - 2 * w); ctx.rotate(Math.sin(p.phase + i) * 0.35);
        ctx.globalAlpha = config.opacity;
        ctx.fillStyle = box; ctx.fillRect(-w, -0.6 * w, 2 * w, 1.6 * w); ctx.fillRect(-1.15 * w, -w, 2.3 * w, 0.5 * w);
        ctx.fillStyle = '#000000'; ctx.globalAlpha = config.opacity * 0.18; ctx.fillRect(-w, -0.5 * w, 2 * w, 0.12 * w);
        ctx.globalAlpha = config.opacity; ctx.fillStyle = ribbon === box ? '#FFFFFF' : ribbon;
        ctx.fillRect(-0.18 * w, -w, 0.36 * w, 2 * w);
        ctx.beginPath(); ctx.ellipse(-0.38 * w, -1.18 * w, 0.42 * w, 0.24 * w, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0.38 * w, -1.18 * w, 0.42 * w, 0.24 * w, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -1.05 * w, 0.16 * w, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    };
    // A green garland along the top edge with baubles and stars swinging beneath it.
    const ornaments = () => {
      const n = Math.min(particles.length, Math.max(4, Math.floor(width / 70))), sag = Math.min(14, height * 0.1) * scale, top = 3;
      ctx.globalAlpha = config.opacity; ctx.strokeStyle = color(2, '#1F7A3D'); ctx.lineWidth = 3.5 * scale; ctx.beginPath(); ctx.moveTo(0, top);
      for (let i = 0; i < n; i++) { const a = i / n * width, b = (i + 1) / n * width; ctx.bezierCurveTo(a + (b - a) / 3, top + sag, a + (b - a) * 2 / 3, top + sag, b, top); }
      ctx.stroke();
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n * width, y = top + sag * 0.75, R = (7 + (i % 3) * 2) * scale;
        const length = Math.min(height * 0.45, (14 + (i * 37 % 5) * 7) * scale), swing = Math.sin(elapsed * config.speed * 1.6 + i * 1.3) * 0.16;
        ctx.save(); ctx.translate(x, y); ctx.rotate(swing);
        ctx.globalAlpha = config.opacity * 0.7; ctx.strokeStyle = color(3, '#C0C7D0'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, length); ctx.stroke();
        ctx.globalAlpha = config.opacity; ctx.fillStyle = color(1, '#F4C430'); ctx.fillRect(-2.5 * scale, length - 1, 5 * scale, 4 * scale);
        ctx.fillStyle = config.colors[i % config.colors.length];
        ctx.translate(0, length + 3 * scale + R);
        if (i % 4 === 3) { ctx.rotate(-swing); drawShape(ctx, { shape: 'star' }, R * 1.2); }
        else {
          ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = config.opacity * 0.35; ctx.fillRect(-R, -R * 0.15, 2 * R, R * 0.3);
          ctx.globalAlpha = config.opacity * 0.6; ctx.beginPath(); ctx.ellipse(-R * 0.38, -R * 0.4, R * 0.22, R * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    };
    // A row of trees on a snow bank: twinkling bulbs and a glowing star on each.
    const trees = () => {
      const n = Math.min(particles.length, Math.max(3, Math.floor(width / 90))), ground = height - 3 * scale;
      ctx.globalAlpha = config.opacity; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, ground, width, height - ground);
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n * width, h = Math.min(height * 0.62, (34 + (i * 7 % 3) * 8) * scale), trunk = 6 * scale, base = ground - trunk;
        ctx.save(); ctx.translate(x, 0);
        ctx.globalAlpha = config.opacity * 0.9; ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.ellipse(0, ground, h * 0.45, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = config.opacity; ctx.fillStyle = '#6B3E1F'; ctx.fillRect(-3 * scale, base, 6 * scale, trunk);
        ctx.fillStyle = color(0, '#1F7A3D');
        for (let k = 0; k < 3; k++) {
          const top = base - h + k * h * 0.27, w = h * (0.24 + k * 0.1);
          ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(w, top + h * 0.46); ctx.lineTo(-w, top + h * 0.46); ctx.closePath(); ctx.fill();
        }
        for (let b = 0; b < 7; b++) {
          const t = (b + 1.2) / 8.4, half = (0.24 + t * 0.3) * h * 0.7, by = base - h + t * h * 0.95, bx = (((b * 0.618 + i * 0.37) % 1) - 0.5) * 2 * half;
          ctx.fillStyle = config.colors.length > 2 ? config.colors[2 + b % (config.colors.length - 2)] : color(1, '#F4C430');
          ctx.globalAlpha = config.opacity * (0.35 + Math.abs(Math.sin(elapsed * config.speed * 3 + b * 1.7 + i)) * 0.65);
          ctx.beginPath(); ctx.arc(bx, by, 1.7 * scale, 0, Math.PI * 2); ctx.fill();
        }
        const glow = 0.75 + Math.sin(elapsed * config.speed * 2 + i) * 0.25;
        ctx.fillStyle = color(1, '#F4C430'); ctx.globalAlpha = config.opacity * 0.3 * glow; ctx.beginPath(); ctx.arc(0, base - h, 8 * scale, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = config.opacity; ctx.translate(0, base - h); drawShape(ctx, { shape: 'star' }, 5 * scale);
        ctx.restore();
      }
    };
    // Light snow, with Santa's sleigh and two reindeer flying across on a gentle wave every ~10 s.
    const santa = dt => {
      ctx.fillStyle = color(0, '#FFFFFF'); ctx.globalAlpha = config.opacity * 0.8;
      for (const p of particles) {
        p.y = (p.y + dt * config.speed * 28 / height) % 1; p.phase += dt * config.speed;
        ctx.beginPath(); ctx.arc(p.x * width + Math.sin(p.phase) * 10, p.y * height, p.size * 0.35, 0, Math.PI * 2); ctx.fill();
      }
      const k = Math.min(1.4, Math.max(0.45, height / 110)) * scale, t = (elapsed * config.speed / 10 + (still ? 0.4 : 0.1)) % 1;
      const gx = -110 * k + t * (width + 150 * k), wave = Math.sin(t * Math.PI * 2);
      const gy = Math.min(height - 10 * k, Math.max(46 * k, height * 0.45 + wave * height * 0.12 + Math.sin(elapsed * 4) * 1.5));
      const m = (x, y) => ctx.moveTo(x * k, y * k), l = (x, y) => ctx.lineTo(x * k, y * k), c = (a, b, d, e, f, g) => ctx.bezierCurveTo(a * k, b * k, d * k, e * k, f * k, g * k);
      const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x * k, y * k, r * k, 0, Math.PI * 2); ctx.fill(); };
      const oval = (x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x * k, y * k, rx * k, ry * k, rot, 0, Math.PI * 2); ctx.fill(); };
      const box = (x, y, w, h) => ctx.fillRect(x * k, y * k, w * k, h * k);
      const red = color(1, '#D62828'), deer = color(2, '#8B5A2B'), gold = color(3, '#F4C430');
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(Math.cos(t * Math.PI * 2) * 0.1);
      // Sparkle trail
      ctx.fillStyle = gold;
      for (let j = 1; j <= 6; j++) { ctx.globalAlpha = config.opacity * (1 - j / 7); dot(-30 - j * 9, 2 + Math.sin(elapsed * 6 + j) * 2, 1.4); }
      ctx.globalAlpha = Math.min(1, config.opacity + 0.35);
      // Reins and harness
      ctx.strokeStyle = gold; ctx.lineWidth = Math.max(0.6, 0.9 * k); ctx.beginPath(); m(2, -22); c(20, -24, 30, -16, 40, -15); m(14, -7); l(40, -11); l(70, -11); ctx.stroke();
      // Two reindeer, galloping
      for (const [ox, lag] of [[44, 0], [76, 1.4]]) {
        const swing = Math.sin(elapsed * 9 * config.speed + lag) * 0.6;
        ctx.strokeStyle = deer; ctx.lineWidth = Math.max(0.8, 1.7 * k); ctx.beginPath();
        m(ox + 6, -9); l(ox + 6 + Math.sin(swing) * 8, -9 + Math.cos(swing) * 8); m(ox + 8, -9); l(ox + 8 + Math.sin(-swing) * 8, -9 + Math.cos(-swing) * 8);
        m(ox - 7, -9); l(ox - 7 + Math.sin(-swing) * 8, -9 + Math.cos(-swing) * 8); m(ox - 5, -9); l(ox - 5 + Math.sin(swing) * 8, -9 + Math.cos(swing) * 8); ctx.stroke();
        ctx.fillStyle = deer; oval(ox, -12, 11, 5.5);
        ctx.beginPath(); m(ox + 6, -15); l(ox + 12, -24); l(ox + 16, -22); l(ox + 11, -12); ctx.closePath(); ctx.fill();
        oval(ox + 16, -25, 4.8, 3, -0.3);
        ctx.fillStyle = '#FFFFFF'; dot(ox - 11, -14, 1.6);
        ctx.fillStyle = '#2B1A0E'; dot(ox + 20.8, -24, 1.2); dot(ox + 16.5, -26.2, 0.6);
        ctx.strokeStyle = '#5A3A1A'; ctx.lineWidth = Math.max(0.6, k); ctx.beginPath();
        m(ox + 14, -27); l(ox + 12, -34); m(ox + 12.8, -31); l(ox + 9.5, -33); m(ox + 16, -27.5); l(ox + 17, -34.5); m(ox + 16.6, -31.5); l(ox + 19.6, -33.5); ctx.stroke();
        ctx.fillStyle = gold; oval(ox + 9, -17, 2, 3.5, 0.6);
      }
      // Sleigh: runners, body, trim
      ctx.strokeStyle = gold; ctx.lineWidth = Math.max(0.8, 1.6 * k); ctx.beginPath(); m(-26, 6); l(16, 6); c(22, 6, 24, 2, 21, -1); m(-16, 0); l(-16, 6); m(4, 0); l(4, 6); ctx.stroke();
      ctx.fillStyle = red; ctx.beginPath(); m(-26, -14); l(10, -14); c(18, -14, 20, -4, 14, 0); l(-22, 0); c(-28, 0, -30, -10, -26, -14); ctx.closePath(); ctx.fill();
      dot(-27, -16, 3.5); ctx.fillStyle = gold; box(-24, -7, 34, 2);
      // Sack of presents
      ctx.fillStyle = deer; oval(-17, -19, 7, 6.5); ctx.fillStyle = gold; box(-24, -24, 6, 6); ctx.fillStyle = '#1F7A3D'; box(-14, -27, 5, 6);
      // Santa
      ctx.fillStyle = red; oval(-2, -20, 7, 8);
      ctx.fillStyle = '#222222'; box(-8.5, -17.5, 13, 2.2); ctx.fillStyle = gold; box(-3, -17.8, 2.6, 2.8);
      ctx.fillStyle = '#F5C9A6'; dot(-1, -30.5, 4);
      ctx.fillStyle = '#FFFFFF'; oval(0, -27.5, 4.2, 3.6);
      ctx.fillStyle = red; ctx.beginPath(); m(-5, -33); l(4, -33.5); l(-7.5, -41); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; box(-5.5, -34.6, 10, 2.2); dot(-7.8, -41.2, 1.7);
      ctx.restore();
    };
    const christmas = { snowflakes, gifts, ornaments, trees, santa }[config.preset];
    return bursting ? fireworks : custom ? moving : christmas || (config.preset === 'lights' ? lights : config.preset === 'diya' ? diyas : config.preset === 'candles' ? candles : falling);
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
