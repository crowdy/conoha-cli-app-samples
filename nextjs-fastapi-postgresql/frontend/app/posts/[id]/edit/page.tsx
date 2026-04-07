import { notFound } from "next/navigation";
import PostForm from "@/app/components/PostForm";

type Post = {
  id: number;
  title: string;
  body: string;
};

async function getPost(id: string): Promise<Post | null> {
  const res = await fetch(`http://backend:8000/api/posts/${id}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function EditPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">投稿を編集</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <PostForm post={post} />
      </div>
    </div>
  );
}
