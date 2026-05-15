import type { Mode } from "@/lib/types";

export interface RealtimeSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioEl: HTMLAudioElement;
  micTrack: MediaStreamTrack;
}

interface SessionConfig {
  client_secret: string;
  expires_at: string;
  model: string;
  session: Record<string, unknown>;
}

/**
 * Mint an ephemeral token from our backend, then open a direct WebRTC
 * connection to the OpenAI Realtime API. All Realtime events arrive on the
 * "oai-events" data channel and are forwarded to `onEvent`.
 *
 * The mic track is added but starts disabled — see setMicEnabled (push-to-talk).
 */
export async function startRealtime(
  mode: Mode,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<RealtimeSession> {
  const res = await fetch("/api/realtime/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`session request failed: ${res.status}`);
  }
  const cfg: SessionConfig = await res.json();

  const pc = new RTCPeerConnection();

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  // getUserMedia must be called from a user-gesture chain (see PushToTalk).
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0];
  micTrack.enabled = false;
  pc.addTrack(micTrack, mic);

  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", (e) => {
    onEvent(JSON.parse(e.data));
  });
  dc.addEventListener("open", () => {
    dc.send(JSON.stringify({ type: "session.update", session: cfg.session }));
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(
    `https://api.openai.com/v1/realtime?model=${cfg.model}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${cfg.client_secret}`,
        "Content-Type": "application/sdp",
      },
    },
  );
  if (!sdpRes.ok) {
    throw new Error(`OpenAI SDP exchange failed: ${sdpRes.status}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  return { pc, dc, audioEl, micTrack };
}

export function setMicEnabled(session: RealtimeSession, enabled: boolean): void {
  session.micTrack.enabled = enabled;
}

/** Send a client event over the Realtime data channel.
 *
 * Silently no-ops if the data channel isn't open yet. This can happen if
 * the user releases push-to-talk very quickly before ICE+DC negotiation
 * completes — without this guard, `dc.send` throws InvalidStateError. */
export function sendEvent(
  session: RealtimeSession,
  event: Record<string, unknown>,
): void {
  if (session.dc.readyState !== "open") return;
  session.dc.send(JSON.stringify(event));
}

export function closeRealtime(session: RealtimeSession): void {
  session.micTrack.stop();
  session.dc.close();
  session.pc.close();
}
