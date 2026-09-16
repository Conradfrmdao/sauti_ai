import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-error">
      <span className="route-error-icon"><SearchX aria-hidden="true" size={22} /></span>
      <p className="eyebrow">404 · Not found</p>
      <h1>That page or case is not available.</h1>
      <p>It may have moved, or your account may not have permission to view it.</p>
      <Link href="/auth/route"><ArrowLeft aria-hidden="true" size={17} /> Return to your workspace</Link>
    </main>
  );
}
