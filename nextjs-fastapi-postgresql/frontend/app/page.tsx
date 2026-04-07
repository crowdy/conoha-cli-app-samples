import Link from "next/link";
import { getPosts } from "./lib/api";

const services = [
  {
    icon: "M5 12h14M12 5l7 7-7 7",
    title: "インターネットインフラ",
    desc: "ドメイン、ホスティング、クラウドなどインターネットの基盤サービスを提供",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    title: "インターネットセキュリティ",
    desc: "電子認証・セキュリティソリューションで安全なインターネット環境を実現",
    color: "bg-green-50 text-green-600",
  },
  {
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    title: "インターネット広告・メディア",
    desc: "デジタルマーケティングで企業の成長をサポート",
    color: "bg-orange-50 text-orange-600",
  },
  {
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    title: "インターネット金融",
    desc: "FX、証券、銀行などオンライン金融サービスを展開",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    title: "暗号資産",
    desc: "暗号資産の交換・マイニング事業を推進",
    color: "bg-yellow-50 text-yellow-600",
  },
  {
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    title: "AI・ロボティクス",
    desc: "最先端のAI技術とロボティクスで未来のインターネットを創造",
    color: "bg-red-50 text-red-600",
  },
];

const companyCards = [
  { title: "会社概要", desc: "CLIインターネットグループの企業情報", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { title: "グループ会社一覧", desc: "国内外110社以上のグループ企業", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
  { title: "サステナビリティ", desc: "ESG・SDGsへの取り組み", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { title: "IR情報", desc: "投資家向け情報・決算資料", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { title: "開発者向け情報", desc: "テックブログ・API・オープンソース", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
  { title: "採用情報", desc: "新卒・キャリア採用", icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
];

export default async function Home() {
  const posts = await getPosts();

  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-primary via-primary-dark to-gray-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: "radial-gradient(circle at 25% 50%, rgba(255,255,255,0.2) 0%, transparent 50%), radial-gradient(circle at 75% 50%, rgba(255,255,255,0.1) 0%, transparent 50%)",
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 py-20 md:py-32 relative">
          <p className="text-blue-200 text-sm font-medium tracking-widest uppercase mb-4">
            CLI Internet Group
          </p>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            すべての人に<br />CLI
          </h1>
          <p className="text-lg md:text-xl text-blue-100 max-w-2xl mb-8">
            インターネットインフラ、広告、金融、暗号資産など幅広い領域で事業を展開。
            テクノロジーの力で、笑顔溢れる社会を実現します。
          </p>
          <div className="flex gap-4">
            <a
              href="#services"
              className="bg-white text-primary font-semibold px-6 py-3 rounded-lg hover:bg-blue-50 transition"
            >
              サービス一覧
            </a>
            <a
              href="#company"
              className="border border-white/40 text-white px-6 py-3 rounded-lg hover:bg-white/10 transition"
            >
              会社情報
            </a>
          </div>
        </div>
      </section>

      {/* Pickup Banner */}
      <section className="bg-primary-light">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4 overflow-x-auto text-sm">
            <span className="bg-accent text-white text-xs font-bold px-2 py-0.5 rounded shrink-0">
              PICKUP
            </span>
            <span className="text-gray-700 shrink-0">CLI Conference 2026 開催決定</span>
            <span className="text-gray-400 shrink-0">|</span>
            <span className="text-gray-700 shrink-0">AI・ロボティクス研究開発拠点を新設</span>
            <span className="text-gray-400 shrink-0">|</span>
            <span className="text-gray-700 shrink-0">通期決算説明会資料を公開</span>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-2">
              Services
            </p>
            <h2 className="text-3xl font-bold text-gray-900">事業・サービス</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((svc) => (
              <div
                key={svc.title}
                className="group bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer"
              >
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${svc.color}`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={svc.icon} />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-primary transition">
                  {svc.title}
                </h3>
                <p className="text-sm text-gray-500">{svc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* News */}
      <section id="news" className="py-16 md:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-2">
                News
              </p>
              <h2 className="text-3xl font-bold text-gray-900">ニュース</h2>
            </div>
            <Link
              href="/news"
              className="text-sm text-primary hover:underline font-medium"
            >
              ニュース一覧 &rarr;
            </Link>
          </div>

          {posts.length === 0 ? (
            <p className="text-gray-500">ニュースはまだありません。</p>
          ) : (
            <div className="space-y-0 bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {posts.slice(0, 5).map((post) => (
                <Link
                  key={post.id}
                  href={`/news/${post.id}`}
                  className="flex items-start gap-4 px-6 py-5 hover:bg-gray-50 transition group"
                >
                  <time className="text-sm text-gray-400 shrink-0 pt-0.5 w-24">
                    {new Date(post.created_at).toLocaleDateString("ja-JP")}
                  </time>
                  <span className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded shrink-0">
                    お知らせ
                  </span>
                  <span className="text-gray-800 text-sm group-hover:text-primary transition line-clamp-1">
                    {post.title}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="text-center mt-8">
            <Link
              href="/news/new"
              className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg hover:bg-primary-dark transition text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              ニュースを投稿
            </Link>
          </div>
        </div>
      </section>

      {/* Company Info Cards */}
      <section id="company" className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-2">
              About Us
            </p>
            <h2 className="text-3xl font-bold text-gray-900">企業情報</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {companyCards.map((card) => (
              <div
                key={card.title}
                className="group bg-white border border-gray-200 rounded-xl p-6 hover:shadow-lg hover:border-primary/30 transition-all cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={card.icon} />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1 group-hover:text-primary transition">
                  {card.title}
                </h3>
                <p className="text-sm text-gray-500">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-primary to-primary-dark text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            インターネットで未来を創造する仲間を募集中
          </h2>
          <p className="text-blue-100 mb-8">
            エンジニア、ビジネス、デザイナーなど幅広い職種で積極採用中です。
          </p>
          <a
            href="#recruitment"
            className="inline-block bg-white text-primary font-semibold px-8 py-3 rounded-lg hover:bg-blue-50 transition"
          >
            採用情報を見る
          </a>
        </div>
      </section>
    </>
  );
}
