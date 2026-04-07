"use client";

import Link from "next/link";
import { useState } from "react";

const navItems = [
  {
    label: "ブランド",
    href: "#brand",
    sub: ["フィロソフィー", "コーポレートアイデンティティ", "グローバルブランド"],
  },
  {
    label: "会社情報",
    href: "#company",
    sub: ["会社概要", "代表メッセージ", "事業内容", "役員紹介", "沿革", "グループ会社", "アクセス"],
  },
  { label: "ニュース", href: "/news" },
  {
    label: "サービス",
    href: "#services",
    sub: ["インフラ", "セキュリティ", "広告・メディア", "金融", "暗号資産"],
  },
  { label: "サステナビリティ", href: "#sustainability" },
  { label: "IR情報", href: "#ir" },
  { label: "採用情報", href: "#recruitment" },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2">
          <div className="bg-primary text-white font-bold text-lg px-3 py-1 rounded">
            CLI
          </div>
          <span className="text-sm font-semibold text-gray-700 hidden sm:inline">
            Internet Group
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="px-3 py-2 text-sm text-gray-700 hover:text-primary hover:bg-primary-light rounded-md transition"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          <button className="text-xs text-gray-500 hover:text-primary border border-gray-300 rounded px-2 py-1">
            EN
          </button>
          <button className="text-xs bg-primary text-white rounded px-3 py-1.5 hover:bg-primary-dark transition">
            お問い合わせ
          </button>
        </div>

        <button
          className="lg:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav className="lg:hidden border-t border-gray-200 bg-white">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
