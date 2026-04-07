import type { Post } from "./types";

const API_BASE = "http://backend:8000/api";

export async function getPosts(): Promise<Post[]> {
  const res = await fetch(`${API_BASE}/posts`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getPost(id: string): Promise<Post | null> {
  const res = await fetch(`${API_BASE}/posts/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
