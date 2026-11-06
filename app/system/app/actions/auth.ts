"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionInput } from "@/lib/actions/run";
import { createSession, deleteSession } from "@/lib/auth/session";
import * as users from "@/lib/services/users";
import {
  changePasswordSchema, loginSchema, registerSchema, updateProfileSchema,
} from "@/lib/validation/schemas";
import { z } from "zod";

// Sign-up, login, logout and the user's own account.

export async function registerAction(input: ActionInput) {
  const result = await runAction(
    registerSchema,
    input,
    async (_actor, data) => {
      const actor = await users.registerFarmer(data);
      await createSession(actor.userId); // log the new farmer straight in
      return { userId: actor.userId };
    },
    { public: true },
  );
  if (result.ok) redirect("/");
  return result;
}

export async function loginAction(input: ActionInput) {
  const result = await runAction(
    loginSchema,
    input,
    async (_actor, data) => {
      const actor = await users.verifyCredentials(data);
      await createSession(actor.userId);
      return { userId: actor.userId };
    },
    { public: true },
  );
  if (result.ok) redirect("/");
  return result;
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}

export async function updateProfileAction(input: ActionInput) {
  return runAction(updateProfileSchema, input, async (actor, data) => {
    const user = await users.updateProfile(actor, data);
    return { userId: user?.userId };
  });
}

export async function changePasswordAction(input: ActionInput) {
  return runAction(changePasswordSchema, input, (actor, data) => users.changePassword(actor, data));
}

export async function deleteAccountAction(input: ActionInput) {
  // Requires typing the word DELETE, so a stray tap can't wipe a farmer's data
  const result = await runAction(
    z.object({ confirm: z.literal("DELETE", { error: "validation.required" }) }),
    input,
    async (actor) => {
      await users.deleteOwnAccount(actor);
      await deleteSession();
    },
  );
  if (result.ok) redirect("/login");
  return result;
}
