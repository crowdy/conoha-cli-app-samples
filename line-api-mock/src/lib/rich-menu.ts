import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus } from "../db/schema.js";

export async function findRichMenuInternalId(
  channelDbId: number,
  richMenuIdStr: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: richMenus.id })
    .from(richMenus)
    .where(
      and(
        eq(richMenus.richMenuId, richMenuIdStr),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);
  return row ? row.id : null;
}
