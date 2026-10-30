import { useEffect, useState } from 'react';

// Keyboard/toolbars can shrink or pan the visible viewport without resizing the
// layout viewport. Keep overlays in that visible rectangle; do not scale UI.
export default function useVisualViewport(active = true) {
  const [bounds, setBounds] = useState(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) { setBounds(null); return; }
    const update = () => setBounds({top:viewport.offsetTop,left:viewport.offsetLeft,width:viewport.width,height:viewport.height});
    update(); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [active]);
  return bounds;
}
