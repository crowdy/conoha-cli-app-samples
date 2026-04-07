import PostForm from "@/app/components/PostForm";

export default function NewPost() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">新規投稿</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <PostForm />
      </div>
    </div>
  );
}
