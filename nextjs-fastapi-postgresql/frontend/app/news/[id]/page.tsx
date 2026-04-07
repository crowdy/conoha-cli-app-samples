import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost } from "@/app/lib/api";

export default async function NewsDetail({
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

      <article>
        <div className="flex items-center gap-3 mb-4">
          <time className="text-sm text-gray-400">
            {new Date(post.created_at).toLocaleDateString("ja-JP")}
          </time>
          <span className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded">
            お知らせ
          </span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-8">{post.title}</h1>
        <div className="prose max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
          {post.body}
        </div>
      </article>

      <div className="mt-12 pt-6 border-t border-gray-200 flex gap-3">
        <Link
          href={`/news/${post.id}/edit`}
          className="text-sm text-primary border border-primary/30 rounded-lg px-4 py-2 hover:bg-primary-light transition"
        >
          編集する
        </Link>
        <Link
          href="/news"
          className="text-sm text-gray-500 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 transition"
        >
          一覧に戻る
        </Link>
      </div>
    </div>
  );
}
