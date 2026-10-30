import { useEffect, useState } from 'react';

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

const opensKeyboard = (element) => {
  if (!element || element.disabled || element.readOnly) return false;
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
  return element.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((element.type || 'text').toLowerCase());
};

// True while a field that raises the on-screen keyboard has focus. Fixed bottom
// chrome uses it to step aside instead of riding up above the keyboard.
export default function useTypingFocus() {
  const [typing, setTyping] = useState(() => typeof document !== 'undefined' && opensKeyboard(document.activeElement));
  useEffect(() => {
    const update = () => setTyping(opensKeyboard(document.activeElement));
    // focusout fires before focus moves on; read activeElement once it settles.
    const settle = () => setTimeout(update, 0);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', settle);
    return () => { document.removeEventListener('focusin', update); document.removeEventListener('focusout', settle); };
  }, []);
  return typing;
}
