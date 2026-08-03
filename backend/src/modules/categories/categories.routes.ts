import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoCoupleError, requireCoupleId } from "../couples/couples.service";
import { DuplicateCategoryError, findVisibleCategories, insertCategory } from "./categories.repository";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

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

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, emoji } = req.body ?? {};
    if (!isNonEmptyString(name)) {
      res.status(400).json({ error: "name is required" });
      return;
    }

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

    try {
      const category = await insertCategory({
        coupleId,
        name: name.trim(),
        emoji: isNonEmptyString(emoji) ? emoji.trim() : null,
      });
      res.status(201).json(category);
    } catch (err) {
      if (err instanceof DuplicateCategoryError) {
        res.status(409).json({ error: "category already exists" });
        return;
      }
      throw err;
    }
  })
);
