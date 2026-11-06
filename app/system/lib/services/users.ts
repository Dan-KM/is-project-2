import "server-only";
import type { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toAppError } from "@/lib/errors";
import { authorize, type Actor } from "@/lib/auth/actor";
import { toRole } from "@/lib/auth/permissions";
import { dbText } from "./shared";
import type {
  changePasswordSchema, loginSchema, registerSchema, updateProfileSchema,
} from "@/lib/validation/schemas";

// Users and authentication. Passwords are hashed and checked INSIDE Postgres
// with pgcrypto's crypt()/gen_salt('bf'), the same bcrypt scheme the seed file
// uses, so the app needs no hashing library and the hash never leaves the DB.

const userRow = { user_id: "pg/uuid@1", user_role: "sql/varchar@1" } as const;

/** Public sign-up always creates a farmer; admins are created by the seed (or another admin). */
export async function registerFarmer(input: z.infer<typeof registerSchema>): Promise<Actor> {
  try {
    const [row] = await db.runtime().query(
      db.raw.sql`
        INSERT INTO users (user_role, first_name, last_name, email, phone, password_hash)
        VALUES ('farmer', ${input.firstName}, ${input.lastName}, ${input.email}, NULLIF(${input.phone ?? ""}, ''),
                crypt(${input.password}, gen_salt('bf', 12)))
        RETURNING user_id, user_role`
        .returnsRow(userRow)
        .build(),
    );
    return { userId: row.user_id, role: toRole(row.user_role) };
  } catch (e) {
    throw toAppError(e);
  }
}

/** Returns the actor for valid credentials; the same error for "no such email" and "wrong password". */
export async function verifyCredentials(input: z.infer<typeof loginSchema>): Promise<Actor> {
  const [row] = await db.runtime().query(
    db.raw.sql`
      SELECT user_id, user_role FROM users
      WHERE LOWER(email) = LOWER(${input.email})
        AND password_hash = crypt(${input.password}, password_hash)`
      .returnsRow(userRow)
      .build(),
  );
  if (!row) throw new AppError("auth.invalidCredentials");
  return { userId: row.user_id, role: toRole(row.user_role) };
}

export async function getProfile(actor: Actor) {
  const user = await db.orm.public.Users
    .select("userId", "userRole", "firstName", "lastName", "email", "phone", "createdAt")
    .where({ userId: actor.userId })
    .first();
  if (!user) throw new AppError("errors.notFound");
  return user;
}

export async function updateProfile(actor: Actor, input: z.infer<typeof updateProfileSchema>) {
  authorize(actor, "user.updateSelf");
  try {
    return await db.orm.public.Users
      .where({ userId: actor.userId })
      .select("userId", "firstName", "lastName", "email", "phone")
      .update({
        firstName: dbText(input.firstName),
        lastName: dbText(input.lastName),
        email: dbText(input.email),
        phone: dbText(input.phone),
      });
  } catch (e) {
    throw toAppError(e);
  }
}

export async function changePassword(actor: Actor, input: z.infer<typeof changePasswordSchema>) {
  authorize(actor, "user.updateSelf");
  // Only succeeds when the current password matches, checked in the same statement
  const rows = await db.runtime().query(
    db.raw.sql`
      UPDATE users SET password_hash = crypt(${input.newPassword}, gen_salt('bf', 12))
      WHERE user_id = ${actor.userId}::uuid
        AND password_hash = crypt(${input.currentPassword}, password_hash)
      RETURNING user_id`
      .returnsRow({ user_id: "pg/uuid@1" })
      .build(),
  );
  if (rows.length === 0) throw new AppError("auth.wrongPassword");
}

/** Deletes the account; farms and everything under them cascade in the DB. */
export async function deleteOwnAccount(actor: Actor) {
  authorize(actor, "user.deleteSelf");
  await db.orm.public.Users.where({ userId: actor.userId }).delete();
}

export async function listUsers(actor: Actor) {
  authorize(actor, "user.list");
  return db.orm.public.Users
    .select("userId", "userRole", "firstName", "lastName", "email", "phone", "createdAt")
    .orderBy((u) => u.createdAt.desc())
    .all();
}
