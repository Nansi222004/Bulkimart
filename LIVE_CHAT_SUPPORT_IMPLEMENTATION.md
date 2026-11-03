# Live Chat Support: Implementation Report

Live chat now runs alongside the existing Support Ticket system. It works in the Customer website, Customer app, Seller web portal, Seller app, Delivery Partner app and Admin panel. The Delivery web portal also got it, because it uses the same shared web component. Tickets are unchanged.

---

## 1. Existing support system (audit)

| Area | What existed before | Reused for chat |
|---|---|---|
| **Ticket model** | One `Ticket` collection with `requesterRole` (customer/seller/delivery), a six-state status machine, related order/product/delivery, `assignedAdmin`. `TicketMessage` holds the thread, including internal notes. | Ticket integration, attachment schema |
| **Ticket API** | `/api/tickets`: categories, create, list, detail, reply, reopen. `/api/admin/tickets`: list, detail, reply, note, assign, status, resolve. | Unchanged; chat links into it |
| **Role resolution** | `ticket.service.resolveRequester` uses the JWT `role` claim plus live Seller/DeliveryPartner records. `assertRelatedEntitiesOwned` handles order ownership per role. | Ownership check reused. The chat role is derived **only** from the token. The ticket version also accepts a `?role=` hint; chat does not. |
| **Socket.IO** | JWT handshake. Server-derived rooms `user:`, `seller:`, `rider:`, `admin:all`. Used for orders and notifications. No chat. | Same server and auth; new chat handlers added |
| **Notifications** | `notifyUser/Seller/Rider/AllAdmins`: persisted, then socket, then FCM. | Reused, plus a new `notifyAdmin` for a single agent |
| **Media** | `uploadAttachments` → `support-tickets` category (**private**). The response layer signs `media:<id>` references per viewer. | Reused unchanged; socket payloads are signed the same way |
| **Web UIs** | Customer: Profile → Help & Support (ticket form and list). Seller: SupportTab, where "Chat with Team" only scrolled to the ticket form. Delivery web: DeliverySupportPage. Admin: TicketsTab. | Chat added beside each one |
| **Mobile UIs** | Customer: ProfileScreen support section. Seller: Support, CreateTicket, TicketDetail screens. Delivery: SupportScreens. Seller app had **no Socket.IO client**. | Chat screen added to each app; `socket.io-client` added to the seller app |
| **Live chat** | **Nothing**: no model, API, socket events or UI anywhere. | Built from scratch |

---

## 2. Architecture

```
Customer web ─┐  LiveChatPanel ─┐                         ┌─ REST /api/support-chat/*        (requester)
Seller web ───┤ (shared web)    ├─ supportChatCore.js ────┤
Delivery web ─┘                 │  (one hook, identical   ├─ REST /api/admin/support-chat/*  (agents)
Customer app ─┐ SupportChatView ┤   in all 4 clients,     │
Seller app ───┤ (shared RN)     │   per-app adapter)      └─ Socket.IO support:* events
Delivery app ─┘                 ┘                                │
Admin panel ── LiveChatTab ─────────────────────────────── supportChat.service.js ── MongoDB
                                                           (single source of rules)  ChatConversation / ChatMessage / SupportAgent
```

- **One backend service** (`services/supportChat.service.js`) holds every rule. REST controllers and socket handlers are thin wrappers around it.
- **Messages are persisted before they are emitted.** Sending works over REST, which is what the clients use and which supports attachments, and also over the socket (`support:message:send`).
- **Rooms:** `support:req:<ROLE>:<userId>` holds a requester's own sockets in one app. `support:agents` holds all connected agents. The server joins sockets to these rooms only after checking the token.
- **Client core:** `supportChatCore.js` is copied verbatim into `frontend/` and the three apps. `frontend/verification/support-chat-sync.test.mjs` fails if any copy drifts.

---

## 3. Database models

**`ChatConversation`** (new)

| Field | Purpose |
|---|---|
| `conversationNumber` | `CHAT-123456`, unique |
| `userId`, `userRole` (`CUSTOMER`/`SELLER`/`DELIVERY`), `userName`, `vendorId` | Who is chatting; the role is fixed by the session |
| `status` (`WAITING`/`ACTIVE`/`RESOLVED`/`CLOSED`), `isOpen` | Lifecycle |
| `supportCategory`, `relatedOrderId`, `relatedDeliveryId`, `relatedTicketId` | Context |
| `assignedAdminId`, `assignedAdminName`, `acceptedAt` | Assignment |
| `queuedAt`, `lastMessageAt`, `lastMessagePreview`, `lastMessageSenderRole` | Queue order and list display |
| `unreadForUser`, `unreadForAgent` | Unread counters |
| `resolvedAt`, `closedAt`, `closedBy`, `reopenCount` | History |

Indexes:
- A **unique partial index** on `{userId, userRole, isOpen:true}` allows one open chat per person per app, even under concurrent requests.
- Indexes back the queue (`status+queuedAt`), lists (`status+lastMessageAt`, `userId+userRole+lastMessageAt`), the agent's chats (`assignedAdminId+status`) and ticket links.

**`ChatMessage`** (new): `conversationId`, `senderId`, `senderRole` (requester roles, `AGENT` or `SYSTEM`), `senderName`, `messageType` (`TEXT`/`ATTACHMENT`/`SYSTEM`), `messageText`, `attachments` (ticket attachment schema), `clientMessageId`, `deliveredAt`, `readAt`, timestamps.
- `{conversationId, createdAt}` is indexed for pagination.
- A unique `{conversationId, senderId, clientMessageId}` index removes duplicates when a client retries a send.

**`SupportAgent`** (new): `adminId` (unique), `status` preference (`AVAILABLE`/`BUSY`/`OFFLINE`), `lastSeenAt`.

**Not modified:** `Ticket`, `TicketMessage`, `Admin`, `User`. There is no migration.

---

## 4. Backend APIs

### Requester: `/api/support-chat` (protect; user sessions only)

| Method & path | Purpose |
|---|---|
| `GET /availability` | Real agent availability and queue position |
| `GET /categories` | Topics for the session's role |
| `GET /conversations` | This app's chat history |
| `POST /conversations` | Start a chat, or resume the open one. Fields: `supportCategory`, `message`, `relatedOrderId?`, `clientMessageId?`, attachments. Rate-limited to 15 per hour. |
| `GET /conversations/:id` | One conversation (own only) |
| `GET /conversations/:id/messages?before=&limit=` | Paginated messages |
| `GET /conversations/:id/messages/:messageId` | Single message (refetch signed URLs) |
| `POST /conversations/:id/messages` | Send a message with up to 3 attachments. Rate-limited to 40 per minute. |
| `POST /conversations/:id/read` | Mark the agent's messages read |
| `POST /conversations/:id/close` | End the chat |
| `POST /conversations/:id/reopen` | Reopen within 7 days, if no other chat is open |

### Agents: `/api/admin/support-chat` (protect + requireAdmin)

| Method & path | Purpose |
|---|---|
| `GET /agents`, `PATCH /agents/me` | Agent list with live status; set own AVAILABLE/BUSY/OFFLINE |
| `GET /conversations?status=&role=&q=&from=&to=&mine=&unread=&page=` | Queue, search and filters, with counts per status |
| `GET /conversations/:id` | Conversation, user, seller or delivery-partner details, related order, previous chats, tickets |
| `GET /conversations/:id/messages[/:messageId]` | History |
| `POST /conversations/:id/messages` | Reply. Replying to a WAITING chat accepts it. |
| `POST /conversations/:id/accept` | Accept. Atomic: only one agent can win. |
| `POST /conversations/:id/assign` `{adminId}` | Assign or transfer |
| `POST /conversations/:id/resolve` / `close` / `reopen` | Lifecycle |
| `POST /conversations/:id/read` | Mark the user's messages read |
| `POST /conversations/:id/ticket` `{subject?}` | Create a ticket from the chat, including the transcript. Idempotent. |
| `POST /conversations/:id/link-ticket` `{ticketId}` | Link an existing ticket of the same user |

**Modified:** `GET /api/admin/tickets/:id` now also returns `relatedChats`. This is additive.

---

## 5. Socket.IO events

| Direction | Event | Notes |
|---|---|---|
| client → server | `support:join` / `support:leave` | Requester joins its own room (the role comes from the token). An admin joins the agents room and is tracked as online. |
| client → server | `support:message:send` `{conversationId, text, clientMessageId}` | Ack returns `{ok, message, duplicate}`. Limited to 15 per 10 s per socket. |
| client → server | `support:message:delivered` `{conversationId, messageIds}` | |
| client → server | `support:message:read` `{conversationId}` | |
| client → server | `support:typing:start` / `support:typing:stop` | Relayed only to the other side of that conversation |
| client → server | `support:agent:status` `{status}` | Admins only |
| server → client | `support:message:new` | `{conversationId, message, conversation}`. Attachments are signed for the receiver. |
| server → client | `support:message:delivered`, `support:message:read`, `support:typing` | |
| server → client | `support:conversation:created` | To agents |
| server → client | `support:conversation:updated` | Plus the named events `:accepted`, `:assigned`, `:close` and `:reopen` |
| server → client | `support:agent:status` | Full agent list, to agents |

On reconnect, clients emit `support:join` again and refetch the open conversation's latest page.

---

## 6. Admin panel

- A new **Live Chat Support** sidebar entry opens `/admin/live-chat`, or `/admin/live-chat/<id>` for a specific conversation. Admin header search also matches "chat".
- **Left panel:**
  - Tabs: Waiting (count), My chats (unread count), Active, Resolved, Closed, All.
  - Search, role filter, date range and an unread-only toggle.
  - Each row shows a role badge, name, waiting time or last activity, preview, a live "typing…" indicator, unread count, status and the assigned agent.
- **Centre panel:**
  - Paginated history and system events.
  - Accept, Assign/Transfer, Resolve, Close, Reopen and Create ticket.
  - Composer with attachments and a typing indicator.
  - Delivery and read state for agent messages.
  - A read-only banner when the chat is assigned to someone else.
- **Right panel:** user details (phone, email, member since), seller store and status or delivery-partner status and vehicle, related order, conversation metadata, the user's tickets (with **Link**) and previous chats.
- The **My status** selector (Available, Busy, Offline) and the online agent count come from live connections.
- In **Support Tickets**, a ticket detail shows pills for its linked live chats, which open the chat.

## 7. Customer website

- Profile → Help & Support has a **Support Tickets | Chat with Support** switch. The existing ticket form and list are unchanged.
- **"Chat with support about this order"** on the order detail page preselects that order.
- Tapping a chat notification in the drawer opens the chat.
- The chat survives a refresh: the open conversation reloads from the server.
- I did **not** add a floating widget, to avoid covering checkout and navigation controls (the brief made this optional).

## 8. Customer app

- A new `/support/chat` screen (expo-router).
- Entry points: a **Chat with Support** card in Profile → Help & Support, a button on order detail, and push notification taps (the route `/support/chat` is what the backend sends).
- Attachments come from the camera, photos or files, using the same Expo pickers as tickets.

## 9. Seller web portal

- In SupportTab, **Chat with Support** (previously "Chat with Team", which only scrolled to the ticket form) now opens the live chat panel, with an optional related-order picker.
- Notification links (`/seller/support?chat=1`) open the chat.
- There are 12 seller topics, as specified.

## 10. Seller app

- A new `SupportChat` screen. Entry points: a button on the Support screen and **Chat with support about this order** on order detail.
- Push taps for chat notifications open the chat.
- Added `socket.io-client@4.8.3`, the same version the other apps use. The connection closes on sign-out.
- Sellers with any profile status, including pending or suspended, can chat. Chat gives no seller capabilities. Onboarding and approval gates are unchanged.

## 11. Delivery Partner app

- A new `SupportChat` screen, registered in **both** the approved and the applicant stacks, so riders still under review can get help.
- Entry: a **Chat with Support** button on the Help & Support screen, which carries the order when opened from a delivery.
- Push routing: `/delivery/support?chat=1` opens the chat.
- There are 12 delivery topics, as specified. Photo attachments come from the camera or gallery; the app has no document picker.
- The rider socket is reused. `join_rider` is still refused for riders who are not approved.

## 12. Notifications

| Event | Recipient | Channel |
|---|---|---|
| Chat started or reopened by the user | All active admins | Persisted, socket and push |
| User message while assigned | The assigned agent only, on the **first unread** message | Persisted and push |
| Agent accepted | Requester | Persisted, socket and push |
| Agent reply | Requester, on the **first unread** message | Persisted, socket and push |
| Resolved or closed by the agent; ticket created | Requester | Persisted, socket and push |
| Chat assigned to you | That agent | Persisted and push |

**No notification contains message text.** A test asserts this. Each requester role is routed through its own channel (`notifyUser`, `notifySeller` or `notifyRider`) so it lands in the right app.

## 13. Support ticket integration

- **Create ticket from chat:**
  - Opens a ticket with the right requester role, the chat topic as category, and the related order.
  - The ticket is set to IN_PROGRESS and assigned to the agent who created it.
  - The full transcript goes in the description and the first ticket message.
  - It is idempotent and race-safe: a conditional link means one chat can only ever have one ticket.
- **Link an existing ticket:** only tickets of the same user can be linked.
- The ticket number shows in the chat header for both the user and the agent. The admin ticket detail lists linked chats.
- The ticket models, APIs, statuses and reply flows are unchanged.

## 14. Security validation

| Requirement | Implementation | Verified by test |
|---|---|---|
| JWT on REST and socket | Existing `protect`; the socket handshake rejects invalid tokens | Invalid-JWT socket is rejected; bad bearer returns 401 |
| Role from the session only | `chatRoleFromToken` plus a profile lookup. Body `userRole`/`userId` are ignored. | "role and ids in the body are ignored" |
| Ownership | Every requester lookup filters by `userId` **and** `userRole` | Another user gets 404 on read, list and post |
| Cross-role isolation | A seller chat is invisible to the same person's customer session | Tested |
| Agent permissions | Only the assignee (or a superAdmin) can reply, resolve, close or transfer; accept is atomic | Second agent gets 409 on accept and 403 on reply and transfer |
| Admin vs user APIs | User sessions cannot call agent APIs, and admins cannot call requester APIs | 403 both ways |
| Socket room authorization | Rooms come from the token. Each event re-checks ownership. | A stranger's socket send gets "Conversation not found"; a non-agent cannot set status |
| XSS | Text is stored as plain text with control characters stripped and a 2000-character cap. Every client renders text, never HTML. | Tested |
| Attachments | JPEG/PNG/WEBP/PDF only (SVG rejected), at most 3 files of 5 MB, stored in the **private** `support-tickets` media category, served only through short-lived signed URLs | Tested |
| Rate limits | Start: 15 per hour; messages: 40 per minute per account; socket: 15 per 10 s | — |
| Duplicates | `clientMessageId` unique index; concurrent starts produce one open chat | Concurrent-start and concurrent-retry tests |
| Unread tracking | Counters change atomically with each message and are reset on read | Tested |

## 15. Testing results

| Suite | Result |
|---|---|
| `backend/__tests__/api/support-chat.http.test.js` (new). Real HTTP, real Socket.IO server and clients, in-memory MongoDB, real JWTs. | **27/27 pass** |
| Backend full suite | 659 passed. The 11 suites that fail were **already failing before this work**: they reference a non-existent `../forntend/` path, a missing `rupeesToPaise` export, a missing `socket.io-client` in the backend, and older checkout and order-flow mocks. Three suites briefly broke because of a link-time import of the new `notifyAdmin`; I fixed that and they pass again. |
| `frontend/verification/support-chat-core.test.mjs` and `support-chat-sync.test.mjs` (new) | 6/6 pass |
| Frontend `test:socket` and `test:auth` (regression) | 7/7 and 36/36 pass |
| Seller app Jest / Delivery app Jest | 53/53 and 84/84 pass |
| ESLint, changed mobile files | 0 errors in all three apps. The remaining warnings are `no-inline-styles`, which match the existing code. |
| Web files | Parsed with esbuild. The frontend has no working ESLint config (this was already the case). |

**Not tested:** real devices and browsers. That covers app background and foreground, push delivery, actual attachment upload to storage, and visual layout at tablet and phone widths.

## 16. Production build status

**No builds were run, as requested.** No `vite build`, Gradle, APK or AAB. Run the web and app builds before release.

## 17. Remaining limitations

1. **Single API process.** Agent presence is tracked in memory and Socket.IO rooms have no Redis adapter. This matches the current single PM2 process. Running several instances needs the Socket.IO Redis adapter and shared presence.
2. **No idle timeout.** WAITING or ACTIVE chats stay open until an agent or the user ends them. This can be added as a scheduled job if wanted.
3. **No floating widget** on the customer website (see section 7).
4. **Any active admin can act as an agent**, the same as for tickets. There is no separate `manage_support` permission yet.
5. **Delivery app attachments are photos only**, because no document picker is installed.
6. **Requesters see availability by polling** (every 30 s and on returning to the app). Agents get it pushed.
7. **The copied client files** (`supportChatCore.js` and `SupportChatView.js`) must be re-copied together when changed; the drift test enforces this.
8. **Unrelated finding (fixed in the file):** `backend/scripts/setupMarketingCmsDiwali.js` had a hardcoded MongoDB connection string with credentials. It now reads only `MONGO_URI` from the environment. The password is still in git history, so it must be rotated in MongoDB Atlas.

## Changed and added files

**Backend.** New:
- `models/ChatConversation.js`, `models/ChatMessage.js`, `models/SupportAgent.js`
- `services/supportChat.service.js`, `controllers/supportChat.controller.js`
- `routes/supportChat.routes.js`, `socket/supportChat.socket.js`
- `__tests__/api/support-chat.http.test.js`

Modified:
- `constants/enums.js`, `services/notification.service.js` (events and `notifyAdmin`)
- `controllers/ticket.controller.js` (exports `uploadAttachments`), `controllers/admin.controller.js` (`relatedChats`)
- `routes/index.js`, `routes/admin.routes.js`, `socket/socket.js` (`tokenRole` and handler registration), `middlewares/rateLimit.middleware.js`

**Web.** New:
- `utils/supportChatCore.js`, `utils/useWebSupportChat.js`
- `components/support/LiveChatPanel.{jsx,css}`, `modules/Admin/components/LiveChatTab.{jsx,css}`
- `verification/support-chat-{core,sync}.test.mjs`

Modified:
- `modules/User/pages/ProfilePage.jsx`, `modules/User/pages/OrderTrackingPage.jsx`, `modules/User/components/NotificationDrawer.jsx`
- `modules/Seller/components/SupportTab.jsx`, `modules/Seller/components/NotificationDrawer.jsx`
- `modules/Delivery/pages/DeliverySupportPage.jsx`
- `modules/Admin/routes/index.jsx`, `components/LeftSidebar.jsx`, `components/TopHeader.jsx`, `components/TicketsTab.jsx`, `context/AdminContext.jsx`

**Customer app.**
- New: `src/utils/supportChatCore.js`, `src/components/SupportChatView.js`, `src/hooks/useSupportChat.js`, `src/screens/SupportChatScreen.jsx`, `app/support/chat.jsx`
- Modified: `src/screens/ProfileScreen.jsx`, `src/screens/OrderTrackingScreen.jsx`

**Seller app.**
- New: `src/utils/supportChatCore.js`, `src/components/SupportChatView.js`, `src/hooks/useAppSupportChat.js`, `src/services/supportSocket.js`, `src/screens/support/SupportChatScreen.js`
- Modified: `src/navigation/RootNavigator.js`, `src/screens/support/SupportScreen.js`, `src/screens/orders/OrderDetailScreen.js`, `src/utils/notificationRouting.js`, `src/context/AuthContext.js`, `package.json` and `package-lock.json` (`socket.io-client`)

**Delivery app.**
- New: `src/utils/supportChatCore.js`, `src/components/SupportChatView.js`, `src/hooks/useAppSupportChat.js`, `src/screens/support/SupportChatScreen.js`
- Modified: `src/navigation/RootNavigator.js`, `src/screens/support/SupportScreens.js`, `src/utils/notificationRouting.js`
