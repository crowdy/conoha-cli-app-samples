import { EventEmitter } from "node:events";

export type AppEvent =
  | { type: "message.inserted"; channelId: number; virtualUserId: number; id: number }
  | { type: "webhook.delivered"; channelId: number; id: number; statusCode: number | null }
  | { type: "api.logged"; id: number };

class AppBus extends EventEmitter {
  emitEvent(ev: AppEvent) {
    this.emit("event", ev);
  }
}

export const bus = new AppBus();
bus.setMaxListeners(0);
