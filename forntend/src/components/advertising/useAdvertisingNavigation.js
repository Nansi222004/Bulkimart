import { useEffect, useState } from 'react';
import { advertisingApi } from './advertisingApi';
// Navigation is opt-in and fails closed; direct routes enforce capabilities too.
export function useAdvertisingNavigation(admin = false) {
  const token = localStorage.getItem(admin ? 'adminToken' : 'sellerToken');
  const [capability, setCapability] = useState(null);
  useEffect(() => {
    let alive = true; setCapability(null);
    if (token) advertisingApi(admin, '/capabilities').then(b => {
      if (alive) setCapability({ token, enabled: admin
        ? b.data.permissions.some(p=>['advertising_finance','advertising_refund','advertising_reconcile'].includes(p)) || (b.data.managementEnabled&&b.data.permissions.some(p=>['advertising_review','advertising_configure'].includes(p)))
        : b.data.managementEnabled });
    }).catch(() => {});
    return () => { alive = false; };
  }, [token, admin]);
  return capability?.token === token && capability.enabled;
}
