import { Router } from "express";
import authRoutes from "./auth.js";
import podcastRoutes from "./podcasts.js";

const apiRoutes = Router();

apiRoutes.get("/health", (req, res) =>
  res.json({ ok: true, service: "ClipFinder AI" }),
);
apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/podcasts", podcastRoutes);

export default apiRoutes;
