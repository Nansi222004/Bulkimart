// Opt-in provider probe: creates an unpaid TEST-mode gateway order only.
// Does not connect to MongoDB, capture a payment, refund or expose credentials.
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createRazorpayOrder, getRazorpayClient, getRazorpayPaymentStatus } from '../services/razorpay.service.js';

const config = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)));
if (!process.argv.includes('--confirm=CREATE_UNPAID_RAZORPAY_TEST_ORDER') || config.RAZORPAY_MODE !== 'test' || !config.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
  console.error('Explicit unpaid test-order confirmation and test-mode credentials required. No provider request sent.'); process.exit(1);
}
try {
  const client = getRazorpayClient(config);
  const order = await createRazorpayOrder({ merchantOrderId: `CHECK-${randomUUID()}`, amountPaise: 100 }, client);
  const status = await getRazorpayPaymentStatus({ orderId: order.orderId }, client);
  console.log(JSON.stringify({ testMode: true, gatewayOrderCreated: Boolean(order.orderId), status: order.status, currency: order.currency, amountPaise: order.amountPaise, paymentState: status.state, charged: false, databaseWrites: 0 }));
} catch (error) {
  console.error(JSON.stringify({ testMode: true, gatewayOrderCreated: false, status: error.statusCode || error.status,
    code: error.error?.code || error.code, message: 'Test gateway request failed; verify configured test credentials and connectivity. No payment capture was requested.' }));
  process.exitCode = 1;
}
