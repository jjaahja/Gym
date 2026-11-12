import type { Metadata } from "next";
import { MonthReviewContent } from "./month-review";

export const metadata: Metadata = { title: "Monatsrückblick" };

export default function MonthReviewPage() {
  return <MonthReviewContent />;
}
