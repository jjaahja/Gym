import type { Metadata } from "next";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Passwort ändern" };

export default function PasswordPage() {
  return <PasswordForm />;
}
