import express from "express";
import {
  saveFcmToken,
  deleteFcmToken,
  getPushStatus,
  sendMyTestPush,
  getMyNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "../controllers/notification.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getMyNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);
router.delete("/:id", deleteNotification);

router.post("/tokens", saveFcmToken);
router.post("/tokens/status", getPushStatus);
router.post("/tokens/test", sendMyTestPush);
router.delete("/tokens/:token", deleteFcmToken);

export default router;
