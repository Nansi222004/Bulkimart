import express from 'express';
import { lookupAddress, lookupPlace } from '../controllers/geo.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { geocodeLimiter } from '../middlewares/rateLimit.middleware.js';

const router = express.Router();

/**
 * Shared geocoding.
 *
 * This started life under /api/delivery because a rider needed it first, but a
 * seller pinning their store needs exactly the same thing, and a shopper adding
 * an address will too. Leaving it there would have meant either a seller calling
 * a delivery endpoint or a second copy of the same paid lookup.
 */
router.get('/reverse', protect, geocodeLimiter, lookupAddress);
// Typed text to a point, for anyone entering a location by hand.
router.get('/forward', protect, geocodeLimiter, lookupPlace);

export default router;
