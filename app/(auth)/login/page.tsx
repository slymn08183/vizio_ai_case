import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — TeamSocial" };

export default function LoginPage() {
  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to act as your team.</p>
      <Card className="p-6">
        <LoginForm />
      </Card>
    </div>
  );
}
