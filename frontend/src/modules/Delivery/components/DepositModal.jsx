import ModalPortal from '../../../components/ModalPortal';
import React from 'react';

export const DepositModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;
  return <ModalPortal className="delivery-modal-overlay"><section className="delivery-order-ping-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="cod-handover-title" style={{ padding: 24, borderRadius: 20 }}>
    <h3 id="cod-handover-title">COD cash handover</h3>
    <p>Open Earnings to report collection and handover against each order. Cash remains outstanding until an administrator independently verifies receipt.</p>
    <p>Historical cash obligations require operations reconciliation.</p>
    <a href="/delivery/earnings" className="delivery-primary-action-btn">Open COD records</a>
    <button type="button" className="delivery-secondary-action-btn" onClick={onClose}>Close</button>
  </section></ModalPortal>;
};
export default DepositModal;
