import 'dotenv/config';
import { setServers } from 'dns';
if (process.env.NODE_ENV !== 'production') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
import mongoose from 'mongoose';
import User from './models/User.js';
import Seller from './models/Seller.js';
import Notification from './models/Notification.js';
import NotificationBroadcast from './models/NotificationBroadcast.js';
import {
  resolveAudienceUserIds, listBroadcasts, cancelScheduledBroadcast, deleteDraftBroadcast, sanitizeDeepLink, getBroadcastStats,
} from './services/broadcast.service.js';
import { notifyUser } from './services/notification.service.js';

/**
 * IMPORTANT — SAFETY NOTE
 *
 * This test deliberately does NOT call createBroadcast()/sendBroadcastNow()
 * against a real ALL_CUSTOMERS/ALL_SELLERS/etc. audience. Those resolve to
 * every real user in this shared database with no test-mode/recipient cap
 * — an earlier version of this file did call them and created 193 real
 * Notification rows for real customers (since cleaned up). Audience
 * resolution itself is read-only and safe to test against real data; the
 * actual fan-out/send is instead exercised here via direct notifyUser()
 * calls scoped ONLY to this file's own throwaway fixture user, which is
 * the exact same function ALL_CUSTOMERS' sender list would have called —
 * this validates the real notification-creation/media/idempotency logic
 * without touching anyone else's account.
 */

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const buyer = await User.create({
    name: 'Broadcast Test Buyer', phone: `9${Date.now().toString().slice(-9)}`, roles: ['buyer'],
  });

  // ============================================================
  // 6. AUDIENCE RESOLUTION — read-only, safe against real data
  // ============================================================
  {
    const ids = await resolveAudienceUserIds('ALL_CUSTOMERS');
    check('6. ALL_CUSTOMERS resolves to real buyer users, includes our fixture', ids.some((id) => String(id) === String(buyer._id)));
  }
  {
    const seller = await Seller.findOne({ status: 'approved' });
    if (seller) {
      const ids = await resolveAudienceUserIds('ALL_SELLERS');
      check('6. ALL_SELLERS resolves via approved Seller.userId', ids.some((id) => String(id) === String(seller.userId)));
    } else console.log('(no approved seller in DB — skipping ALL_SELLERS resolution check)');
  }

  // ============================================================
  // Deep link sanitisation (Section 15 — no open redirect)
  // ============================================================
  {
    try {
      sanitizeDeepLink('http://evil.example.com/phish', 'ALL_CUSTOMERS');
      check('deep link rejects an absolute/open-redirect URL', false);
    } catch (err) {
      check('deep link rejects an absolute/open-redirect URL', err.status === 400);
    }
    check('deep link accepts a same-site customer path', sanitizeDeepLink('/orders', 'ALL_CUSTOMERS') === '/orders');
    try {
      sanitizeDeepLink('//evil.example.com', 'ALL_CUSTOMERS');
      check('deep link rejects a protocol-relative URL', false);
    } catch (err) {
      check('deep link rejects a protocol-relative URL', err.status === 400);
    }
  }

  // ============================================================
  // 7/8/12/13. NOTIFICATION CREATION — via notifyUser, scoped ONLY to our
  // own fixture user (this is the exact function ALL_CUSTOMERS' sender
  // list would call per-recipient — same code path, safe blast radius).
  // ============================================================
  const fakeBroadcastId = new mongoose.Types.ObjectId();
  let createdNotifId;
  {
    const n = await notifyUser(buyer._id, {
      event: 'ADMIN_BROADCAST', title: 'Media Sale', message: 'Look at this',
      media: { mediaType: 'IMAGE', url: 'https://example.com/x.jpg', publicId: 'x', mimeType: 'image/jpeg', size: 1234 },
      metadata: { broadcastId: fakeBroadcastId },
    });
    createdNotifId = n?._id;
    check('7/8. notification is actually created for the recipient', !!n);
    check('13. notification contains media', n?.media?.url === 'https://example.com/x.jpg');
    check('event is the dedicated ADMIN_BROADCAST event, not a business event', n?.event === 'ADMIN_BROADCAST');
    check('type category is "broadcast", not overloaded onto an existing one', n?.type === 'broadcast');
  }
  {
    // 11/28. A notification with NO media (the existing/default shape) still works exactly as before.
    const n = await notifyUser(buyer._id, { event: 'SYSTEM', title: 'Plain', message: 'no media here' });
    check('11/28. notification without media still works (media stays unset, not null-object)', n && n.media === undefined && n.title === 'Plain');
    await Notification.deleteOne({ _id: n._id });
  }

  // ============================================================
  // 22. READ/OPEN TRACKING — real isRead flag, real count query
  // ============================================================
  {
    await Notification.updateOne({ _id: createdNotifId }, { $set: { isRead: true } });
    const { readCount } = await getBroadcastStats(fakeBroadcastId);
    check('22. read/open tracking reflects the real isRead flag', readCount === 1);
  }

  // ============================================================
  // 3/4/5. LIST / SEARCH / STATUS FILTER — against a manually-created
  // NotificationBroadcast row (no send triggered — DRAFT stays a no-op).
  // ============================================================
  const draftDoc = await NotificationBroadcast.create({
    title: 'Draft Only Test', message: 'x', targetAudience: 'ALL_CUSTOMERS', channels: ['PUSH'],
    status: 'DRAFT', createdBy: new mongoose.Types.ObjectId(),
  });
  {
    const { rows, total } = await listBroadcasts({ page: 1, limit: 50, search: 'Draft Only Test' });
    check('3. broadcast appears in Admin list', rows.some((r) => String(r._id) === String(draftDoc._id)));
    check('4. search works', total >= 1 && rows.every((r) => /draft only test/i.test(r.title)));
  }
  {
    const { rows } = await listBroadcasts({ page: 1, limit: 50, status: 'DRAFT' });
    check('5. status filter works', rows.every((r) => r.status === 'DRAFT') && rows.some((r) => String(r._id) === String(draftDoc._id)));
  }

  // ============================================================
  // 18/19. SCHEDULED status + cancel-transition guard (no real audience touched)
  // ============================================================
  const scheduledDoc = await NotificationBroadcast.create({
    title: 'Scheduled Test', message: 'x', targetAudience: 'ALL_CUSTOMERS', channels: ['PUSH'],
    status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 3600_000), createdBy: new mongoose.Types.ObjectId(),
  });
  {
    check('18. scheduled broadcast stored with status SCHEDULED, no sentAt', scheduledDoc.status === 'SCHEDULED' && !scheduledDoc.sentAt);
    const cancelled = await cancelScheduledBroadcast(scheduledDoc._id);
    check('19. cancel scheduled broadcast works', cancelled.status === 'CANCELLED');
    try {
      await cancelScheduledBroadcast(scheduledDoc._id);
      check('cannot cancel an already-cancelled broadcast', false);
    } catch (err) {
      check('cannot cancel an already-cancelled broadcast', err.meta?.code === 'INVALID_BROADCAST_TRANSITION');
    }
  }
  {
    // delete-draft guard: a SCHEDULED (now CANCELLED) row is not a DRAFT — must be refused.
    try {
      await deleteDraftBroadcast(scheduledDoc._id);
      check('cannot delete a non-draft broadcast', false);
    } catch (err) {
      check('cannot delete a non-draft broadcast', err.meta?.code === 'INVALID_BROADCAST_TRANSITION');
    }
    await deleteDraftBroadcast(draftDoc._id); // this one really is a DRAFT — must succeed
    const stillThere = await NotificationBroadcast.findById(draftDoc._id);
    check('can delete a genuine draft', !stillThere);
  }

  // ---- cleanup ----
  await NotificationBroadcast.deleteMany({ _id: { $in: [draftDoc._id, scheduledDoc._id] } });
  await Notification.deleteOne({ _id: createdNotifId });
  await User.deleteOne({ _id: buyer._id });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
