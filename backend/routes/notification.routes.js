import express from "express";
import {
  saveFcmToken,
  deleteFcmToken,
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
router.delete("/tokens/:token", deleteFcmToken);

export default router;
