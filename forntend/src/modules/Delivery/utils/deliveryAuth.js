import { apiUrl } from '../../../utils/api';
import { openSessionDashboard } from '../../../utils/userSession';
import { saveDeliverySession, captureDeliverySession, isCurrentDeliverySession } from '../../../utils/deliverySession';

export async function completeDeliveryLogin(phone, otp, name, intent) {
  const snapshot = captureDeliverySession();
  const response = await fetch(apiUrl('/api/auth/delivery/verify-otp'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, otp, intent }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'OTP verification failed');
  if (!body.success || body.sessionRole !== 'delivery' || !body.token || !body.user?._id) throw new Error('Invalid Delivery login session. Please sign in again.');
  let profile = body.deliveryState;
  if (intent === 'register') {
    const started = await fetch(apiUrl('/api/delivery/start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` }, body: JSON.stringify(name ? { name } : {}),
    });
    const result = await started.json();
    if (!started.ok || !result.success) throw new Error(result.message || 'Could not start your Delivery registration. Sign in to resume.');
    profile = result.data;
  }
  if (!profile || typeof profile.status !== 'string') throw new Error('Delivery profile is unavailable. Please sign in again.');
  if (!isCurrentDeliverySession(snapshot)) throw new Error('Your session changed. Please sign in again.');
  saveDeliverySession(body);
  openSessionDashboard(body.sessionRole);
  return { body, profile };
}
