// voice-agent-conoha-l4/frontend/lib/voice.ts
import type { Mode } from "@/lib/types";

export interface VoiceSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
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

  let mic: MediaStream | undefined;
  let micTrack: MediaStreamTrack | undefined;

  try {
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    micTrack = mic.getAudioTracks()[0];
    pc.addTrack(micTrack, mic);

    // CONTRACT: The server creates the "ui-events" DataChannel before sending
    // the answer SDP, so the channel arrives via ondatachannel during the
    // offer/answer exchange. The client must NOT call createDataChannel() —
    // doing so creates a second, independent channel that the server never
    // writes to, causing all server events to be silently dropped.
    let dc: RTCDataChannel | null = null;
    pc.ondatachannel = (e) => {
      dc = e.channel;
      e.channel.addEventListener("message", (m) => {
        try {
          onEvent(JSON.parse(m.data) as AgentEvent);
        } catch {
          // ignore malformed
        }
      });
    };

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

    return { pc, dc, audioEl, micTrack, sessionId: ans.session_id };
  } catch (err) {
    try { mic?.getTracks().forEach((t) => t.stop()); } catch {}
    pc.close();
    throw err;
  }
}

export function closeVoice(s: VoiceSession): void {
  s.micTrack.stop();
  if (s.dc) {
    try { s.dc.close(); } catch {}
  }
  s.pc.close();
}
