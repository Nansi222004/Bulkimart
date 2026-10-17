import { useEffect } from 'react';

export default function useSellerDialog(ref, open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previous = document.activeElement;
    const dialog = ref.current;
    const controls = () => [...(dialog?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])].filter(el => el.getClientRects().length);
    controls()[0]?.focus();
    const trap = event => {
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener('keydown', trap);
    return () => { dialog?.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus?.(); };
  }, [open, ref]);
}
