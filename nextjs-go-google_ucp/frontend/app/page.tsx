"use client";

import { useEffect, useState } from "react";
import { fetchProducts } from "@/lib/api";
import { ProductCard } from "@/components/product-card";

interface Product {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  image_url: string;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    fetchProducts().then(setProducts);
  }, []);

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold">Our Flowers</h1>
      <p className="mb-8 text-muted-foreground">
        A demo flower shop powered by Google&apos;s Universal Commerce Protocol
        (UCP)
      </p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </main>
  );
}
