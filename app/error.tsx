"use client";

import { useEffect } from "react";
import { Button, Card } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In a real app this would go to an error reporter (Sentry, etc.).
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-12 max-w-sm text-center">
      <Card className="p-8">
        <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
        <p className="mb-6 text-sm text-muted">
          An unexpected error occurred. You can try again.
        </p>
        <Button onClick={reset}>Try again</Button>
      </Card>
    </div>
  );
}
