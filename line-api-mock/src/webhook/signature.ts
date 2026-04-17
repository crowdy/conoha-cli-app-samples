import { createHmac } from "node:crypto";

export function signBody(channelSecret: string, body: string): string {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}
