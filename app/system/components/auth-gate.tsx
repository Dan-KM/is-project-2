import { Suspense } from "react";
import { requirePageActor } from "@/lib/page";

/**
 * For pages whose content needs no data: sends logged-out visitors to the
 * login page. Reading the session cookie must sit behind Suspense, so the
 * rest of the page can still render instantly. (Actions check again anyway.)
 */
export function AuthGate() {
  return (
    <Suspense fallback={null}>
      <Check />
    </Suspense>
  );
}

async function Check() {
  await requirePageActor();
  return null;
}
