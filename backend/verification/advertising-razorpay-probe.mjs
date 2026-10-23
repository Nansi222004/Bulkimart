// Explicit, test-mode-only provider transport probe. No database/bootstrap,
// capture, refund, campaign mutation or environment-file writes.
import {readFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {getRazorpayClient} from '../services/razorpay.service.js';
if(!process.argv.includes('--create-test-order'))throw Error('Pass --create-test-order to authorize one synthetic Razorpay test order');
const file=dotenv.parse(await readFile(new URL('../.env',import.meta.url)));
const config=Object.fromEntries(['RAZORPAY_MODE','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'].map(key=>[key,process.env[key]||file[key]]));
if(config.RAZORPAY_MODE!=='test'||!config.RAZORPAY_KEY_ID?.startsWith('rzp_test_'))throw Error('Probe requires explicitly configured Razorpay test credentials');
const timeout=setTimeout(()=>{console.log(JSON.stringify({ok:false,stage:'test-order-transport',reason:'TIMEOUT'}));process.exit(1);},20000);
try{
  const client=getRazorpayClient(config);
  const order=await client.orders.create({amount:100,currency:'INR',receipt:`ads-probe-${Date.now()}`,notes:{purpose:'ADVERTISING_TRANSPORT_TEST_ONLY'}});
  const verified=await client.orders.fetch(order.id);
  if(verified.id!==order.id||verified.amount!==100||verified.currency!=='INR')throw Error('PROVIDER_ORDER_MISMATCH');
  console.log(JSON.stringify({ok:true,mode:'test',orderCreatedAndFetched:true,amountPaise:100,paymentCaptured:false,refundIssued:false}));
}catch(error){
  // Never serialize gateway errors: SDK request objects may contain credentials.
  const transport=['EACCES','EPERM','ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].find(code=>code===error.code||code===error.cause?.code);
  console.log(JSON.stringify({ok:false,stage:'test-order-transport',httpStatus:error.statusCode||error.status||null,transport:transport||null,reason:error.statusCode===401?'AUTHENTICATION_REJECTED':'PROVIDER_OR_NETWORK_FAILURE'}));
  process.exitCode=1;
}finally{clearTimeout(timeout);}
