import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import useVisualViewport from '../hooks/useVisualViewport';
import { lockModal, isTopModal } from '../utils/modalLayer';
import './ModalPortal.css';

export default function ModalPortal({children, className = '', style, ...props}) {
  const ref = useRef(null);
  const bounds = useVisualViewport();
  useEffect(() => {
    const layer = ref.current, previous = document.activeElement;
    if (!layer.querySelector('[role="dialog"],[role="alertdialog"]') && !props.role) {
      layer.setAttribute('role','dialog'); layer.setAttribute('aria-modal','true');
      layer.setAttribute('aria-label',props['aria-label'] || layer.querySelector('h1,h2,h3,h4')?.textContent || 'Dialog');
    }
    const unlock = lockModal(layer);
    const controls = () => [...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(node => node.getClientRects().length);
    if (!layer.contains(document.activeElement)) (controls()[0] || layer).focus({preventScroll:true});
    const keydown = event => {
      if (!isTopModal(layer) || event.key !== 'Tab') return;
      const items = controls(), index = items.indexOf(document.activeElement);
      if (!items.length) { event.preventDefault(); layer.focus(); }
      else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown); unlock();
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus?.({preventScroll:true});
    };
  }, []);
  return createPortal(<div ref={ref} tabIndex={-1} {...props}
    className={`${className} modal-viewport`} style={{...style,position:'fixed',inset:0,...(bounds ? {...bounds,right:'auto',bottom:'auto'} : {}),zIndex:12000 + Math.min(6000, Number(style?.zIndex || 0))}}>{children}</div>, document.body);
}
