import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Actor } from "@/lib/auth/actor";
import { getActor } from "@/lib/auth/current-user";
import { AppError } from "@/lib/errors";

// Helpers for Server Component pages.

/** The logged-in user, or a redirect to the login page. */
export async function requirePageActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * Await a service read; a missing or not-owned record shows the 404 page
 * instead of an error screen (services report other farmers' data as notFound).
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof AppError && (e.key === "errors.notFound" || e.key === "errors.forbidden")) notFound();
    throw e;
  }
}
