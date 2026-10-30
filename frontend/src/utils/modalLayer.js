const layers = [];
let previousOverflow, previousInert;

// Nested sheets and confirmation dialogs share one lock. Closing a child must
// not unlock the page behind the parent, or leave the page locked on cleanup.
export function lockModal(layer) {
  if (!layers.length) {
    previousOverflow = document.body.style.overflow;
    previousInert = document.getElementById('root')?.inert;
    document.body.style.overflow = 'hidden';
    const root = document.getElementById('root');
    if (root) root.inert = true;
  }
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (!layers.length) {
      document.body.style.overflow = previousOverflow;
      const root = document.getElementById('root');
      if (root) root.inert = previousInert;
    }
  };
}

export const isTopModal = layer => layers.at(-1) === layer;
