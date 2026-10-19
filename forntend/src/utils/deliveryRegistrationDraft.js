const PREFIX = 'bulkimart:delivery-registration:';
const memory = new Map();
const FIELDS = ['vehicleType', 'vehicleNumber', 'dlNumber', 'dlExpiry', 'bankHolder', 'bankName', 'bankAccount', 'bankIfsc', 'upiId', 'zones', 'deliveryRadius', 'location'];

export function deliveryDraftOwner() {
  try {
    if (!localStorage.getItem('deliveryToken')) return null;
    const profile = JSON.parse(localStorage.getItem('deliveryUserProfile') || 'null');
    return profile?._id || profile?.id || null;
  } catch { return null; }
}

export function readDeliveryRegistrationDraft(owner) {
  if (!owner) return null;
  if (memory.has(owner)) return memory.get(owner);
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + owner) || 'null');
    if (saved?.version !== 1 || saved.owner !== owner || !saved.form) return null;
    return { ...saved, form: Object.fromEntries(FIELDS.filter(key => key in saved.form).map(key => [key, saved.form[key]])) };
  } catch { return null; }
}

export function saveDeliveryRegistrationDraft(owner, draft) {
  if (!owner) return;
  memory.set(owner, { ...draft, form: { ...draft.form } });
  // Browser-session draft only. Documents and the full Aadhaar number remain
  // in memory; they are never serialized into browser storage.
  const form = Object.fromEntries(FIELDS.filter(key => key in draft.form).map(key => [key, draft.form[key]]));
  try { sessionStorage.setItem(PREFIX + owner, JSON.stringify({ version: 1, owner, form, step: draft.step,
    needsFileReselection: Object.values(draft.files || {}).some(Boolean),
  })); } catch { /* Registration still works when browser storage is blocked. */ }
}

export function clearDeliveryRegistrationDraft(owner) {
  memory.delete(owner);
  try { sessionStorage.removeItem(PREFIX + owner); } catch { /* Storage may be unavailable. */ }
}

export function clearDeliveryRegistrationDrafts() {
  memory.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
}
