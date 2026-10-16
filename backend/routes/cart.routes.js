import express from 'express';
import mongoose from 'mongoose';
import { getWholesaleCart, changeWholesaleCart } from '../controllers/wholesaleCart.controller.js';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  getCartSummary,
  getUnifiedCart,
  updateCartItemMessage,
} from '../controllers/cart.controller.js';
import { protect, requireCustomerSession } from '../middlewares/auth.middleware.js';
import { httpError } from '../utils/response.js';

const router = express.Router();

// A cart belongs to a signed-in account — there is no guest cart.
router.use(protect, requireCustomerSession);
router.use((req, res, next) => {
  if (req.userType !== 'user' || !mongoose.isValidObjectId(req.user?._id)) {
    return next(httpError(403, 'A valid customer account is required to use the cart'));
  }
  next();
});

router.route('/wholesale').get(getWholesaleCart).post(changeWholesaleCart).delete(changeWholesaleCart);
router.route('/wholesale/:itemId').put(changeWholesaleCart).delete(changeWholesaleCart);

router.route('/')
  .get(getCart)
  .post(addToCart)
  .delete(clearCart);

// must sit above /:itemId or "summary" is read as an item id
router.get('/summary', getCartSummary);

// Same reason — and additive: /api/cart above is untouched.
router.get('/unified', getUnifiedCart);

router.patch('/items/:itemId/message', updateCartItemMessage);
router.patch('/:itemId/message', updateCartItemMessage);

router.route('/:itemId')
  .put(updateCartItem)
  .delete(removeCartItem);

export default router;
