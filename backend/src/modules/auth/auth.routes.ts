import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { loginHandler, registerHandler } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(registerHandler));
authRouter.post("/login", asyncHandler(loginHandler));
