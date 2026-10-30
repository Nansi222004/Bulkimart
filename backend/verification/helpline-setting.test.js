import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import jwt from "jsonwebtoken";
import helplineRoutes from "../routes/helpline.routes.js";
import adminRoutes from "../routes/admin.routes.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { JWT_SECRET } from "../config/jwt.js";
import HelplineSetting from "../models/HelplineSetting.js";
import Admin from "../models/Admin.js";

const app = express();
app.use(express.json());
app.use("/api/helpline", helplineRoutes);
app.use("/api/admin", adminRoutes);
app.use(errorHandler);

describe("Dynamic Platform Helpline & Emergency Settings", () => {
  let db;
  let adminId;
  let adminToken;

  beforeAll(async () => {
    db = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await db?.stop();
  });

  beforeEach(async () => {
    for (const collection of Object.values(mongoose.connection.collections)) {
      await collection.deleteMany({});
    }
    adminId = new mongoose.Types.ObjectId();
    await Admin.create({
      _id: adminId,
      name: "Super Admin",
      email: "helpline-admin@bulkimart.test",
      password: "hashedpassword123",
      role: "superAdmin",
      isActive: true,
    });
    adminToken = jwt.sign({ id: String(adminId), type: "admin" }, JWT_SECRET);
  });

  test("GET /api/helpline returns default SOS (112) and helpline (1800-111-2233)", async () => {
    const res = await request(app).get("/api/helpline");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sosEmergencyNumber).toBe("112");
    expect(res.body.data.bulkimartHelplineNumber).toBe("1800-111-2233");
    expect(res.body.data.sellerHelplineNumber).toBe("1800-111-2233");
  });

  test("Admin updates helpline numbers, then public endpoint serves updated numbers", async () => {
    const updatePayload = {
      sosEmergencyNumber: "911",
      bulkimartHelplineNumber: "+91 98765 43210",
      sellerHelplineNumber: "1800-999-8877",
      riderHelplineNumber: "+91 99999 88888",
      description: "Updated city-specific helpline",
    };

    const adminRes = await request(app)
      .post("/api/admin/helpline-setting")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(updatePayload);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);
    expect(adminRes.body.data.sosEmergencyNumber).toBe("911");
    expect(adminRes.body.data.bulkimartHelplineNumber).toBe("+91 98765 43210");

    // Public endpoint immediately serves the updated values
    const publicRes = await request(app).get("/api/helpline");
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.data.sosEmergencyNumber).toBe("911");
    expect(publicRes.body.data.bulkimartHelplineNumber).toBe("+91 98765 43210");
    expect(publicRes.body.data.sellerHelplineNumber).toBe("1800-999-8877");
  });

  test("Rejects invalid numbers without numeric digits", async () => {
    const invalidPayload = {
      sosEmergencyNumber: "no-digits-here",
    };

    const res = await request(app)
      .post("/api/admin/helpline-setting")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(invalidPayload);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
