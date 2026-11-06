import { AppError } from "@/lib/errors";
import { can, type Permission, type Role } from "./permissions";

/**
 * Who is performing an operation. Every service takes one, so authorisation is
 * checked next to the data no matter who calls the service (server action,
 * test script, future API route).
 */
export type Actor = {
  userId: string;
  role: Role;
};

/** Throw "forbidden" unless the actor's role may perform the action. */
export function authorize(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new AppError("errors.forbidden");
}
