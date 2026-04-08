"use client";

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCart } from "./cart-provider";

interface Product {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  image_url: string;
}

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();

  const price = (product.price_cents / 100).toFixed(2);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="h-48 rounded-md bg-gradient-to-br from-pink-100 to-purple-100 flex items-center justify-center text-4xl">
          {product.name.includes("Sunflower") && "🌻"}
          {product.name.includes("Rose") && "🌹"}
          {product.name.includes("Lavender") && "💜"}
          {product.name.includes("Wildflower") && "🌺"}
          {product.name.includes("Lily") && "🤍"}
        </div>
        <CardTitle className="text-lg">{product.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-sm text-muted-foreground">{product.description}</p>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <span className="text-lg font-bold">${price}</span>
        <Button
          size="sm"
          onClick={() =>
            addItem({
              product_id: product.id,
              name: product.name,
              price_cents: product.price_cents,
            })
          }
        >
          Add to Cart
        </Button>
      </CardFooter>
    </Card>
  );
}
