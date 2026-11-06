import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";
import { toRole } from "./permissions";
import { getSessionUserId } from "./session";

/** The logged-in user as an Actor, or null. Role comes fresh from the DB. */
export async function getActor(): Promise<Actor | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const user = await db.orm.public.Users.select("userId", "userRole").where({ userId }).first();
  return user ? { userId: user.userId, role: toRole(user.userRole) } : null;
}

/** Like getActor, but throws "please log in" when there is no valid session. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("errors.unauthenticated");
  return actor;
}
