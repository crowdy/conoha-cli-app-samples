import QRCode from "qrcode";
import { MODES } from "@/lib/types";

async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 320 });
}

export default async function HomePage() {
  const base = process.env.PUBLIC_BASE_URL ?? "";
  if (!base) {
    return (
      <main className="min-h-screen p-8 flex flex-col items-center gap-4">
        <h1 className="text-2xl font-bold text-red-500">設定エラー</h1>
        <p className="text-zinc-300 text-center max-w-xl">
          <code>PUBLIC_BASE_URL</code> がビルド時に設定されていません。
          QR コードを生成できません。 <code>.env</code> を確認し、
          <code>docker compose build</code> をやり直してください。
        </p>
      </main>
    );
  }
  const cards = await Promise.all(
    MODES.map(async (m) => ({
      ...m,
      url: `${base}/talk?mode=${m.mode}`,
      qr: await qrDataUrl(`${base}/talk?mode=${m.mode}`),
    }))
  );

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-8">
      <h1 className="text-3xl font-bold">音声エージェント・デモ</h1>
      <p className="opacity-70">QR をスキャンしてモードを選択</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {cards.map((c) => (
          <a
            key={c.mode}
            href={c.url}
            className="bg-zinc-900 rounded-2xl p-6 flex flex-col items-center gap-3 hover:bg-zinc-800 transition"
          >
            <div className="text-5xl">{c.emoji}</div>
            <div className="text-xl font-semibold">{c.label}</div>
            <img src={c.qr} alt={c.label} className="rounded bg-white p-2" />
            <code className="text-xs opacity-60">mode={c.mode}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
