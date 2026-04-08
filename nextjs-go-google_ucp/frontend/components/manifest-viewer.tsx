"use client";

import { useEffect, useState } from "react";
import { fetchManifest } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function ManifestViewer() {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading manifest...</p>;
  if (!manifest) return <p className="text-red-500">Failed to load manifest.</p>;

  const ucp = manifest.ucp as Record<string, unknown>;
  const services = ucp.services as Record<string, unknown>;
  const capabilities = ucp.capabilities as Array<Record<string, string>>;
  const payment = manifest.payment as Record<string, unknown>;
  const handlers = payment.handlers as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Protocol Version
            <Badge>{ucp.version as string}</Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <Accordion defaultValue={["services", "capabilities", "payment"]}>
        <AccordionItem value="services">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              Services <Badge variant="outline">{Object.keys(services).length}</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {Object.entries(services).map(([name, svc]) => {
              const service = svc as Record<string, unknown>;
              const rest = service.rest as Record<string, string>;
              return (
                <div key={name} className="mb-3 rounded border p-3">
                  <p className="font-mono text-sm font-bold">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    Endpoint: <code>{rest.endpoint}</code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Spec: <code>{service.spec as string}</code>
                  </p>
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="capabilities">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              Capabilities <Badge variant="outline">{capabilities.length}</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {capabilities.map((cap) => (
              <div key={cap.name} className="mb-3 rounded border p-3">
                <p className="font-mono text-sm font-bold">{cap.name}</p>
                {cap.extends && (
                  <Badge variant="secondary" className="mt-1">
                    extends {cap.extends}
                  </Badge>
                )}
                {cap.spec && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Spec: <code>{cap.spec}</code>
                  </p>
                )}
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="payment">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              Payment Handlers <Badge variant="outline">{handlers.length}</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {handlers.map((h) => {
              const config = h.config as Record<string, string>;
              return (
                <div key={h.id as string} className="mb-3 rounded border p-3">
                  <p className="font-mono text-sm font-bold">{h.name as string}</p>
                  <p className="text-xs text-muted-foreground">ID: {h.id as string}</p>
                  <div className="mt-1">
                    {Object.entries(config).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="mr-1">
                        {k}: {v}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Raw JSON</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded bg-gray-900 p-4 text-xs text-green-400">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
