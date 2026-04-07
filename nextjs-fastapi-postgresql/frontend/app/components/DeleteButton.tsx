"use client";

type Props = {
  id: number;
  action: (formData: FormData) => Promise<void>;
};

export default function DeleteButton({ id, action }: Props) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!confirm("このニュースを削除しますか？")) {
      e.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 rounded px-3 py-1.5 hover:border-red-200 transition"
      >
        削除
      </button>
    </form>
  );
}
