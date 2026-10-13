import 'dotenv/config';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.OTP_MODE = 'mock';

const [{ default: authRoutes }, { default: sellerRoutes }, { errorHandler }, { default: User }, { default: Seller }] = await Promise.all([
  import('../routes/auth.routes.js'),
  import('../routes/seller.routes.js'),
  import('../middlewares/error.middleware.js'),
  import('../models/User.js'),
  import('../models/Seller.js'),
]);

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/sellers', sellerRoutes);
app.use(errorHandler);

const suffix = String(Date.now()).slice(-7);
const phone = `0${suffix}`.padStart(10, '0').slice(-10);
let userId;

await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone', { autoIndex: false });
try {
  const sent = await request(app).post('/api/auth/send-otp').send({ phone, isLogin: false });
  if (sent.status !== 200 || !sent.body.otp) throw new Error(`OTP send probe failed (${sent.status})`);

  const verified = await request(app).post('/api/auth/verify-otp').send({
    phone, otp: sent.body.otp, isLogin: false, name: 'Automated Registration Verification',
  });
  if (verified.status !== 200 || !verified.body.token) throw new Error(`OTP verification probe failed (${verified.status})`);
  userId = verified.body.user?._id;

  const started = await request(app).post('/api/sellers/start')
    .set('Authorization', `Bearer ${verified.body.token}`)
    .send({ salesChannels: ['ecommerce'] });
  if (started.status !== 200 || started.body.seller?.status !== 'incomplete') {
    throw new Error(`Seller onboarding probe failed (${started.status}): ${started.body?.message || 'unknown error'}`);
  }

  console.log(JSON.stringify({ otpVerified: true, sellerProfileCreated: true, approvalBypassed: false, cleanupPending: true }));
} finally {
  if (userId) {
    await Seller.deleteOne({ userId });
    await User.deleteOne({ _id: userId });
  } else {
    const probeUser = await User.findOne({ phone }).select('_id').lean();
    if (probeUser) {
      await Seller.deleteOne({ userId: probeUser._id });
      await User.deleteOne({ _id: probeUser._id });
    }
  }
  console.log(JSON.stringify({ probeAccountRemoved: true }));
  await mongoose.disconnect();
}
