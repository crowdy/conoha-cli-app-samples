import Link from "next/link";

const footerLinks = [
  {
    title: "会社情報",
    links: ["会社概要", "代表メッセージ", "事業内容", "役員紹介", "沿革", "グループ会社"],
  },
  {
    title: "サービス",
    links: ["インフラ", "セキュリティ", "広告・メディア", "金融", "暗号資産"],
  },
  {
    title: "サステナビリティ",
    links: ["マネジメント", "マテリアリティ", "人的資本", "環境", "ガバナンス"],
  },
  {
    title: "ニュース",
    links: ["プレスリリース", "IR", "テックブログ", "セキュリティブログ"],
  },
];

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {footerLinks.map((section) => (
            <div key={section.title}>
              <h3 className="text-white font-semibold text-sm mb-3">
                {section.title}
              </h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="#"
                      className="text-xs text-gray-400 hover:text-white transition"
                    >
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-700 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="bg-white text-primary font-bold text-sm px-2 py-0.5 rounded">
              CLI
            </div>
            <span className="text-sm text-gray-400">Internet Group, Inc.</span>
          </div>

          <div className="flex gap-4 text-xs text-gray-400">
            <Link href="#" className="hover:text-white">サイトポリシー</Link>
            <Link href="#" className="hover:text-white">プライバシーポリシー</Link>
            <Link href="#" className="hover:text-white">セキュリティ</Link>
            <Link href="#" className="hover:text-white">お問い合わせ</Link>
          </div>

          <p className="text-xs text-gray-500">
            &copy; 2026 CLI Internet Group, Inc. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
