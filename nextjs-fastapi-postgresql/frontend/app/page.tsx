import Link from "next/link";

type Post = {
  id: number;
  title: string;
  body: string;
  created_at: string;
};

async function getPosts(): Promise<Post[]> {
  const res = await fetch("http://backend:8000/api/posts", {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

async function deletePost(formData: FormData) {
  "use server";
  const id = formData.get("id");
  await fetch(`http://backend:8000/api/posts/${id}`, { method: "DELETE" });
  const { redirect } = await import("next/navigation");
  redirect("/");
}

export default async function Home() {
  const posts = await getPosts();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">投稿一覧</h1>
        <Link
          href="/posts/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          新規作成
        </Link>
      </div>

      {posts.length === 0 ? (
        <p className="text-gray-500">投稿がありません。</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                {post.title}
              </h2>
              <p className="text-gray-700 whitespace-pre-wrap mb-4">
                {post.body}
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">
                  {new Date(post.created_at).toLocaleString("ja-JP")}
                </span>
                <div className="flex gap-2">
                  <Link
                    href={`/posts/${post.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    編集
                  </Link>
                  <form action={deletePost}>
                    <input type="hidden" name="id" value={post.id} />
                    <button
                      type="submit"
                      className="text-red-600 hover:underline"
                    >
                      削除
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
