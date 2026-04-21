import { randomBytes } from "node:crypto";

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function messageId(): string {
  // LINE message IDs are 18-digit numeric strings.
  let s = String(1 + Math.floor(Math.random() * 9));
  for (let i = 1; i < 18; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

export function replyToken(): string {
  return randomHex(16);
}

export function accessTokenStr(): string {
  // Opaque; long enough that collisions are negligible.
  return randomHex(24);
}

export function channelAccessTokenKid(): string {
  return randomHex(8);
}

export function couponId(): string {
  return "COUPON_" + randomBytes(16).toString("base64url");
}

export function richMenuId(): string {
  return "richmenu-" + randomBytes(16).toString("hex");
}
