import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Sign-in error — TeamSocial" };

export default function AuthCodeErrorPage() {
  return (
    <div className="mx-auto mt-12 max-w-sm text-center">
      <Card className="p-8">
        <h1 className="mb-2 text-lg font-semibold">Couldn&apos;t sign you in</h1>
        <p className="mb-6 text-sm text-muted">
          The sign-in link was invalid or has expired. Please try again.
        </p>
        <LinkButton href="/login">Back to sign in</LinkButton>
      </Card>
    </div>
  );
}
