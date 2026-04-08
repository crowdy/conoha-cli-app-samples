"use client";

import Link from "next/link";
import { useCart } from "./cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function NavBar() {
  const { itemCount } = useCart();

  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold">
          UCP Flower Shop
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/inspector">
            <Button variant="outline" size="sm">
              UCP Inspector
            </Button>
          </Link>
          <Link href="/checkout">
            <Button variant="default" size="sm">
              Cart
              {itemCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {itemCount}
                </Badge>
              )}
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
}
