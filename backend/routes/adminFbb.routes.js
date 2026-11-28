import express from 'express';
import { requireWarehousePermission } from '../middlewares/warehousePermission.middleware.js';
import { requireFinancePermission } from '../middlewares/financePermission.middleware.js';
import * as fbb from '../controllers/fbbAdmin.controller.js';
import * as fbbReturns from '../controllers/fbbReturns.controller.js';

/**
 * /api/admin/fbb — mounted inside admin.routes.js, so every route is already behind protect + requireAdmin.
 * Warehouse work needs manage_warehouse; FBB charges and billing need manage_finance.
 */
const router = express.Router();

// ---- money (finance permission) -------------------------------------------------------------------------------
const finance = express.Router();
finance.use(requireFinancePermission);
finance.get('/charge-config', fbb.getChargeConfigs);
finance.post('/charge-config', fbb.createChargeConfig);
finance.get('/charges', fbb.listChargesAdmin);
finance.get('/charges/reconciliation', fbb.getChargeReconciliation);
finance.post('/charges/:id/reverse', fbb.reverseChargeAdmin);
finance.get('/billing', fbb.listFbbBilling);
finance.get('/billing/:sellerId', fbb.getSellerFbbBilling);
finance.post('/billing/:sellerId/settle', fbb.settleSellerFbbAdmin);
router.use('/finance', finance);

// ---- warehouse operations (warehouse permission) -----------------------------------------------------------------
router.use(requireWarehousePermission);
router.get('/overview', fbb.getFbbOverview);
router.get('/warehouses', fbb.listWarehouses);
router.post('/warehouses', fbb.createWarehouse);
router.put('/warehouses/:id', fbb.updateWarehouse);
// FBB pilot: which sellers may use FBB while it is not open to all (FBB_ALL_SELLERS_ENABLED).
router.get('/pilot-sellers', fbb.listFbbPilotSellers);
router.put('/pilot-sellers/:sellerId', fbb.setFbbPilotSeller);
router.get('/products', fbb.listFbbProductsForReceiving);
router.get('/stock', fbb.listWarehouseStock);
router.get('/movements', fbb.listWarehouseMovements);
router.get('/shipments', fbb.listShipments);
router.get('/receipts', fbb.listReceipts);
router.post('/receipts', fbb.createReceiptAdmin);
router.post('/receipts/:id/post', fbb.postReceiptAdmin);
router.post('/receipts/:id/cancel', fbb.cancelReceiptAdmin);
router.get('/adjustments', fbb.listAdjustments);
router.post('/adjustments', fbb.requestAdjustmentAdmin);
router.post('/adjustments/:id/decision', fbb.decideAdjustmentAdmin);
router.get('/reconciliation', fbb.getInventoryReconciliation);
router.post('/reconciliation/:productId/resync', fbb.resyncMirrorAdmin);

router.get('/orders', fbb.listFbbOrdersAdmin);
router.post('/orders/:id/accept', fbb.acceptFbbOrderAdmin);
router.post('/orders/:id/pick', fbb.pickFbbOrderAdmin);
router.post('/orders/:id/pack', fbb.packFbbOrderAdmin);
router.post('/orders/:id/handoff', fbb.handoffFbbOrderAdmin);
router.post('/orders/:id/cancel', fbb.cancelFbbOrderAdmin);
router.post('/orders/:id/inspect', fbb.inspectFbbOrderAdmin);
router.get('/orders/:id/fulfillment-options', fbb.fbbFulfillmentOptions);
router.post('/orders/:id/fulfillment/manual', fbb.fbbSelectRider);
router.post('/orders/:id/fulfillment/shiprocket', fbb.fbbBookShiprocket);

// FBB returns are decided and handled by Bulkimart, not the seller.
router.get('/returns', fbbReturns.listFbbReturns);
router.post('/returns/:returnId/decision', fbbReturns.decideFbbReturn);
router.get('/returns/:returnId/pickup-options', fbbReturns.fbbReturnPickupOptions);
router.post('/returns/:returnId/pickup', fbbReturns.selectFbbReturnPickup);
router.post('/returns/:returnId/pickup/refresh', fbbReturns.refreshFbbReturnCourier);
router.post('/returns/:returnId/mark-received', fbbReturns.markFbbReturnReceived);

export default router;
