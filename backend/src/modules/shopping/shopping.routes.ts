import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { addItemHandler, checkItemHandler, deleteItemHandler, listItemsHandler } from "./shopping.controller";

export const shoppingRouter = Router();

shoppingRouter.use(requireAuth);

shoppingRouter.post("/", asyncHandler(addItemHandler));
shoppingRouter.get("/", asyncHandler(listItemsHandler));
shoppingRouter.patch("/:id/check", asyncHandler(checkItemHandler));
shoppingRouter.delete("/:id", asyncHandler(deleteItemHandler));
