"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManifestViewer } from "@/components/manifest-viewer";
import { CheckoutSimulator } from "@/components/checkout-simulator";

export default function InspectorPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">UCP Inspector</h1>
      <p className="mb-6 text-muted-foreground">
        Explore the UCP manifest and simulate an AI agent checkout flow.
      </p>

      <Tabs defaultValue="manifest">
        <TabsList>
          <TabsTrigger value="manifest">Manifest Viewer</TabsTrigger>
          <TabsTrigger value="simulator">Checkout Simulator</TabsTrigger>
        </TabsList>
        <TabsContent value="manifest">
          <ManifestViewer />
        </TabsContent>
        <TabsContent value="simulator">
          <CheckoutSimulator />
        </TabsContent>
      </Tabs>
    </main>
  );
}
