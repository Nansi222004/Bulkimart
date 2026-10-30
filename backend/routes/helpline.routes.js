import { Router } from "express";
import { getPublicHelpline } from "../controllers/helpline.controller.js";

const router = Router();

// Public route to fetch active helpline & SOS emergency numbers
router.get("/", getPublicHelpline);

export default router;
