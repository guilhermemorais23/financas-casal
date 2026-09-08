import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoGroupError, requireGroupId } from "../groups/groups.service";
import {
  DuplicateCategoryError,
  deleteCategory,
  findCategoryById,
  findVisibleCategories,
  insertCategory,
  updateCategory,
} from "./categories.repository";

export class CategoryNotFoundError extends Error {}
export class DefaultCategoryError extends Error {}

// Shared by PATCH/DELETE below -- only a category that belongs to this
// group can be touched. A default (groupId: null) category is shared by
// every group in the app, so it's never editable/deletable by anyone; a
// category belonging to a *different* group must 404, not reveal it exists.
async function requireOwnCategory(userId: string, categoryId: string) {
  const groupId = await requireGroupId(userId);
  const category = await findCategoryById(categoryId);
  if (!category || category.groupId !== groupId) {
    throw new CategoryNotFoundError();
  }
  if (category.isDefault) {
    throw new DefaultCategoryError();
  }
  return category;
}

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    let groupId: string;
    try {
      groupId = await requireGroupId(req.user!.id);
    } catch (err) {
      if (err instanceof NoGroupError) {
        res.status(404).json({ error: "no group yet" });
        return;
      }
      throw err;
    }
    const categories = await findVisibleCategories(groupId);
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

    let groupId: string;
    try {
      groupId = await requireGroupId(req.user!.id);
    } catch (err) {
      if (err instanceof NoGroupError) {
        res.status(404).json({ error: "no group yet" });
        return;
      }
      throw err;
    }

    try {
      const category = await insertCategory({
        groupId,
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

categoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { name, emoji } = req.body ?? {};
    if (
      (name !== undefined && !isNonEmptyString(name)) ||
      (emoji !== undefined && emoji !== null && !isNonEmptyString(emoji))
    ) {
      res.status(400).json({ error: "invalid category update" });
      return;
    }

    try {
      await requireOwnCategory(req.user!.id, req.params.id);
      const category = await updateCategory(req.params.id, {
        name: isNonEmptyString(name) ? name.trim() : undefined,
        emoji: emoji !== undefined ? (isNonEmptyString(emoji) ? emoji.trim() : null) : undefined,
      });
      res.status(200).json(category);
    } catch (err) {
      if (err instanceof NoGroupError || err instanceof CategoryNotFoundError) {
        res.status(404).json({ error: "category not found" });
        return;
      }
      if (err instanceof DefaultCategoryError) {
        res.status(403).json({ error: "cannot edit a default category" });
        return;
      }
      throw err;
    }
  })
);

categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await requireOwnCategory(req.user!.id, req.params.id);
      await deleteCategory(req.params.id);
      res.status(204).send();
    } catch (err) {
      if (err instanceof NoGroupError || err instanceof CategoryNotFoundError) {
        res.status(404).json({ error: "category not found" });
        return;
      }
      if (err instanceof DefaultCategoryError) {
        res.status(403).json({ error: "cannot delete a default category" });
        return;
      }
      throw err;
    }
  })
);
