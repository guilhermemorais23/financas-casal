import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoGroupError } from "../groups/groups.service";
import { getBillsOverview } from "./upcoming.service";

export const billsRouter = Router();

billsRouter.use(requireAuth);
billsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await getBillsOverview(req.user!.id));
    } catch (err) {
      if (err instanceof NoGroupError) {
        res.status(404).json({ error: "no group" });
        return;
      }
      throw err;
    }
  })
);
