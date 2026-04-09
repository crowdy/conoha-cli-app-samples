import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH || "/data/chat.db";
const db = new Database(DB_PATH, { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export function saveMessage(
  nickname: string,
  content: string
): { id: number; nickname: string; content: string; created_at: string } {
  const stmt = db.prepare(
    "INSERT INTO messages (nickname, content) VALUES (?, ?) RETURNING *"
  );
  return stmt.get(nickname, content) as {
    id: number;
    nickname: string;
    content: string;
    created_at: string;
  };
}

export function getMessages(limit = 50): {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
}[] {
  const stmt = db.prepare(
    "SELECT * FROM messages ORDER BY id DESC LIMIT ?"
  );
  return (stmt.all(limit) as any[]).reverse();
}
