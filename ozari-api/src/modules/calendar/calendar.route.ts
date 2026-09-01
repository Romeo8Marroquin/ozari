import { Router, type Express, type Router as RouterType } from "express";
import rateLimit from "express-rate-limit";
import { appConfig } from "@/config/app.js";
import { verifyJwt } from "@middlewares/auth.middleware.js";
import { isGrantedRoles } from "@middlewares/role.middleware.js";
import { RolesEnum } from "@models/enums/rolesEnum.js";
import {
  authorizeGoogleCalendar,
  createCalendarFeed,
  deleteCalendarFeed,
  disconnectGoogleCalendar,
  getCalendarFeed,
  getCalendarStatus,
  googleCalendarCallback,
} from "./calendar.controller.js";

const router: RouterType = Router();

// Region: **STRICTLY Admin**, every route — the same stance as orders creation. A connection writes
// this business's whole schedule into somebody's personal calendar, so who may do that is not a
// capability to widen casually. When a Driver may connect their own, the guard widens TOGETHER with
// the sync's connection scoping (`activeCalendarConnections`), never before it.
const canManageCalendar = isGrantedRoles([RolesEnum.Admin]);

router.get("/", verifyJwt, canManageCalendar, getCalendarStatus);

// Region: the Google grant. `authorize` hands back a URL for the browser to visit; the CALLBACK is
// not here — it cannot be, because it arrives from Google with no session of ours (see below).
router.get("/google/authorize", verifyJwt, canManageCalendar, authorizeGoogleCalendar);
router.delete("/google", verifyJwt, canManageCalendar, disconnectGoogleCalendar);

// Region: the ICS subscription token. Creating REGENERATES, which is also how it is revoked.
router.post("/feed", verifyJwt, canManageCalendar, createCalendarFeed);
router.delete("/feed", verifyJwt, canManageCalendar, deleteCalendarFeed);

export default router;

/**
 * The two routes that CANNOT sit behind the API-key check, mounted before it in `createApp`.
 *
 * - **The OAuth callback** arrives as a top-level browser navigation from Google. It carries no
 *   header we control and no cookie of ours (the refresh cookie is scoped to `/api/auth`), so the
 *   signed `state` is its authentication — which is exactly what OAuth's state parameter is for.
 * - **The ICS feed** is fetched by Apple Calendar, Outlook or Google's crawler. There is no way to
 *   give any of them an API key, an origin or a session; the 32-byte token in the path is the
 *   credential, and regenerating it revokes every subscription at once.
 *
 * Both get their own strict limiter rather than riding a shared tier: they are the only
 * unauthenticated write-adjacent surface in the app, and a feed URL that leaked should be expensive
 * to hammer. The feed is generous enough for real clients — Apple polls at minutes, not seconds.
 */
export function mountCalendarPublicRoutes(app: Express): void {
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
  });
  app.get(
    `${appConfig.basePath}/calendar/google/callback`,
    limiter,
    googleCalendarCallback,
  );
  app.get(`${appConfig.basePath}/calendar/feed/:token`, limiter, getCalendarFeed);
}
