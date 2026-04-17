"use client";

import { useState, FormEvent } from "react";

export default function Home() {
  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_email: toEmail,
          to_name: toName,
          message,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "送信に失敗しました");
      }

      setStatus("success");
      setToEmail("");
      setToName("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "送信に失敗しました");
    }
  }

  return (
    <div className="container">
      <h1>メンバー招待</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="to_email">メールアドレス *</label>
          <input
            id="to_email"
            type="email"
            required
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="member@example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="to_name">名前</label>
          <input
            id="to_name"
            type="text"
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            placeholder="田中太郎"
          />
        </div>
        <div className="form-group">
          <label htmlFor="message">メッセージ</label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="チームに参加してください"
          />
        </div>
        <button type="submit" disabled={status === "sending"}>
          {status === "sending" ? "送信中..." : "招待メールを送信"}
        </button>
      </form>
      {status === "success" && (
        <div className="message success">招待メールを送信しました</div>
      )}
      {status === "error" && (
        <div className="message error">{errorMessage}</div>
      )}
    </div>
  );
}
