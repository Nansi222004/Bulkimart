import express from 'express';
import {
  createOrder,
  createUnifiedOrder,
  getMyOrders,
  getOrderById,
  trackOrder,
  cancelOrder,
  requestReturn,
} from '../controllers/order.controller.js';
import { getOrderItemReturnEligibility } from '../controllers/return.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .post(createOrder)
  .get(getMyOrders);

// Above /:id, or "unified" is read as an order id. Additive: POST /api/orders
// is untouched and every existing single-storefront checkout still uses it.
router.post('/unified', createUnifiedOrder);

router.get('/:id', getOrderById);
router.get('/:id/track', trackOrder);
router.patch('/:id/cancel', cancelOrder);
router.post('/:id/return', requestReturn); // legacy whole-order endpoint — untouched, see Return V1's own item-level system at /api/returns

// Return & Refund V1 (item-level) — the eligibility check nests under the
// order it belongs to, same as /:id/track and /:id/cancel above; the
// return REQUEST itself lives at POST /api/returns (routes/return.routes.js),
// since a return is its own resource, not a sub-action of the order.
router.get('/:orderId/items/:itemId/return-eligibility', getOrderItemReturnEligibility);

export default router;
