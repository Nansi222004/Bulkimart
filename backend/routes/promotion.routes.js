import express from 'express';
const router = express.Router();
// Historical promotion URLs cannot expose or reactivate the retired feature.
router.use((_req, res) => res.status(410).json({ success: false, message: 'Seller promotions have been removed.' }));
export default router;
