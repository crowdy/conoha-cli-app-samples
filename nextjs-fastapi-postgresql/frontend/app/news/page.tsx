import Link from "next/link";
import { getPosts } from "@/app/lib/api";
import DeleteButton from "@/app/components/DeleteButton";

async function deletePost(formData: FormData) {
  "use server";
  const id = formData.get("id");
  const res = await fetch(`http://backend:8000/api/posts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete post");
  const { redirect } = await import("next/navigation");
  redirect("/news");
}

export default async function NewsPage() {
  const posts = await getPosts();

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="mb-8">
        <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-2">
          News
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">ニュース一覧</h1>
          <Link
            href="/news/new"
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark transition text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新規投稿
          </Link>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">ニュースはまだありません。</p>
          <Link
            href="/news/new"
            className="text-primary hover:underline font-medium text-sm"
          >
            最初のニュースを投稿する &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <article
              key={post.id}
              className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <time className="text-sm text-gray-400">
                      {new Date(post.created_at).toLocaleDateString("ja-JP")}
                    </time>
                    <span className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded">
                      お知らせ
                    </span>
                  </div>
                  <Link
                    href={`/news/${post.id}`}
                    className="text-lg font-semibold text-gray-900 hover:text-primary transition"
                  >
                    {post.title}
                  </Link>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                    {post.body}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/news/${post.id}/edit`}
                    className="text-xs text-gray-500 hover:text-primary border border-gray-200 rounded px-3 py-1.5 hover:border-primary/30 transition"
                  >
                    編集
                  </Link>
                  <DeleteButton id={post.id} action={deletePost} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
