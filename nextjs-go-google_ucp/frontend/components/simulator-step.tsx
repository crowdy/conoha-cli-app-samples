"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SimulatorStepProps {
  step: number;
  title: string;
  description: string;
  request?: { method: string; url: string; body?: unknown };
  response?: unknown;
  active: boolean;
  children: React.ReactNode;
}

export function SimulatorStep({
  step,
  title,
  description,
  request,
  response,
  active,
  children,
}: SimulatorStepProps) {
  return (
    <Card className={active ? "border-blue-500" : "opacity-50"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Badge variant={active ? "default" : "secondary"}>Step {step}</Badge>
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}

        {request && (
          <div>
            <p className="mb-1 text-xs font-bold text-muted-foreground">REQUEST</p>
            <pre className="rounded bg-gray-900 p-3 text-xs text-blue-400 overflow-auto max-h-48">
              {request.method} {request.url}
              {request.body ? "\n\n" + JSON.stringify(request.body, null, 2) : null}
            </pre>
          </div>
        )}

        {response ? (
          <div>
            <p className="mb-1 text-xs font-bold text-muted-foreground">RESPONSE</p>
            <pre className="rounded bg-gray-900 p-3 text-xs text-green-400 overflow-auto max-h-48">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
