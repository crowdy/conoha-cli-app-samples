// voice-agent-conoha-l4/frontend/lib/voice.ts
import type { Mode } from "@/lib/types";

export interface VoiceSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioEl: HTMLAudioElement;
  micTrack: MediaStreamTrack;
  sessionId: string;
}

export type AgentEvent =
  | { type: "user_transcript"; text: string; language: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "order_persisted"; order_id: string }
  | { type: "empty_transcript" }
  | { type: "error"; detail: string };

export async function startVoice(
  mode: Mode,
  onEvent: (e: AgentEvent) => void,
): Promise<VoiceSession> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0];
  pc.addTrack(micTrack, mic);

  const dc = pc.createDataChannel("ui-events");
  let resolveSession: (s: VoiceSession) => void;
  const ready = new Promise<VoiceSession>((r) => { resolveSession = r; });

  dc.addEventListener("message", (e) => {
    try {
      onEvent(JSON.parse(e.data) as AgentEvent);
    } catch {
      // ignore malformed
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const resp = await fetch("/api/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: offer.sdp, type: offer.type, mode }),
  });
  if (!resp.ok) throw new Error(`offer failed: ${resp.status}`);
  const ans = await resp.json() as { sdp: string; type: string; session_id: string };
  await pc.setRemoteDescription({ type: ans.type as RTCSdpType, sdp: ans.sdp });

  const session: VoiceSession = { pc, dc, audioEl, micTrack, sessionId: ans.session_id };
  resolveSession!(session);
  return session;
}

export function closeVoice(s: VoiceSession): void {
  s.micTrack.stop();
  try { s.dc.close(); } catch {}
  s.pc.close();
}
