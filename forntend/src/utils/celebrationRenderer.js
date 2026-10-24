// One bounded Canvas 2D loop per mounted overlay. No DOM particles or dependencies.
export function startCelebration(canvas, config, env = window) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let frame = 0, previous = 0, elapsed = 0, width = 0, height = 0, stopped = false, visible = !env.IntersectionObserver;
  const doc = canvas.ownerDocument;
  const particles = Array.from({ length: Math.min(100, Math.max(1, config.density)) }, () => ({ x: Math.random(), y: Math.random(), size: 2 + Math.random() * 5, phase: Math.random() * Math.PI * 2, color: config.colors[Math.floor(Math.random() * config.colors.length)] }));
  const resize = () => {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(env.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const draw = time => {
    frame = 0;
    if (stopped || doc.hidden || !visible) return;
    const delta = previous ? Math.max(0, (time - previous) / 1000) : 0;
    const dt = Math.min(delta, 0.05); previous = time; elapsed += delta;
    ctx.clearRect(0, 0, width, height);
    if (elapsed >= config.duration) { stopped = true; return; }
    if (width && height) for (const p of particles) {
      p.y = (p.y + dt * config.speed * 45 / height) % 1;
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
    frame = env.requestAnimationFrame(draw);
  };
  const visibility = () => { env.cancelAnimationFrame(frame); frame = 0; previous = 0; if (!doc.hidden && visible && !stopped) frame = env.requestAnimationFrame(draw); };
  const intersection = env.IntersectionObserver ? new env.IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); }) : null;
  intersection?.observe(canvas);
  const observer = env.ResizeObserver ? new env.ResizeObserver(resize) : null;
  observer?.observe(canvas); env.addEventListener('resize', resize); doc.addEventListener('visibilitychange', visibility);
  resize(); visibility();
  return () => { stopped = true; env.cancelAnimationFrame(frame); observer?.disconnect(); intersection?.disconnect(); env.removeEventListener('resize', resize); doc.removeEventListener('visibilitychange', visibility); ctx.clearRect(0, 0, width, height); };
}
