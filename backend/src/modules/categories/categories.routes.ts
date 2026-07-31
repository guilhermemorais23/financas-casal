import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoCoupleError, requireCoupleId } from "../couples/couples.service";
import { findVisibleCategories } from "./categories.repository";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let coupleId: string;
    try {
      coupleId = await requireCoupleId(req.user!.id);
    } catch (err) {
      if (err instanceof NoCoupleError) {
        res.status(404).json({ error: "no couple yet" });
        return;
      }
      throw err;
    }
    const categories = await findVisibleCategories(coupleId);
    res.status(200).json(categories);
  })
);
