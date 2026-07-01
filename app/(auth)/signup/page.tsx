import { Card } from "@/components/ui";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Sign up — TeamSocial" };

export default function SignupPage() {
  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">Create your team</h1>
      <p className="mb-6 text-sm text-muted">
        One account, one team. Everything you post is under your team&apos;s
        identity.
      </p>
      <Card className="p-6">
        <SignupForm />
      </Card>
    </div>
  );
}
