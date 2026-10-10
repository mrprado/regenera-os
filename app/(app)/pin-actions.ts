"use server";
// Pinned items (phase 25). Identity always comes from the session; view-only and read-only users cannot pin.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { pinRecord, reorderPins, unpin, type PinResult } from "@/lib/pins/queries";
import { PIN_TYPES, type PinType } from "@/lib/pins/vocab";

const zId = z.string().uuid();
const zType = z.enum(Object.keys(PIN_TYPES) as [PinType, ...PinType[]]);

export async function pinAction(type: string, entityId: string, replaceId?: string): Promise<PinResult> {
  const t = zType.parse(type), id = zId.parse(entityId), replace = replaceId ? zId.parse(replaceId) : undefined;
  const result = await withOsUser(user => pinRecord(appDb(), user.scope, user.email, t, id, replace));
  revalidatePath("/", "layout");
  return result;
}

export async function unpinAction(pinId: string) {
  const id = zId.parse(pinId);
  await withOsUser(user => unpin(appDb(), user.email, id));
  revalidatePath("/", "layout");
}

export async function reorderPinsAction(order: string[]) {
  const ids = z.array(zId).max(12).parse(order);
  await withOsUser(user => reorderPins(appDb(), user.email, ids));
  revalidatePath("/", "layout");
}
