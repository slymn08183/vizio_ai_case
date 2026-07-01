import { Card, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto mt-12 max-w-sm text-center">
      <Card className="p-8">
        <h1 className="mb-2 text-lg font-semibold">Page not found</h1>
        <p className="mb-6 text-sm text-muted">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <LinkButton href="/">Back home</LinkButton>
      </Card>
    </div>
  );
}
