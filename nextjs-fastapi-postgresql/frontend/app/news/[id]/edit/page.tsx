import { notFound } from "next/navigation";
import PostForm from "@/app/components/PostForm";
import Link from "next/link";
import { getPost } from "@/app/lib/api";

export default async function EditNews({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link
        href="/news"
        className="text-sm text-primary hover:underline mb-6 inline-block"
      >
        &larr; ニュース一覧に戻る
      </Link>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">ニュースを編集</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <PostForm post={post} />
      </div>
    </div>
  );
}
