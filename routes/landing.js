import express from "express";
import { _tenantsList } from "../config.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.render("landing", { tenants: _tenantsList });
});

export default router;
