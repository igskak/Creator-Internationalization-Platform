import { PlaceholderPage } from "@/components/shell/placeholder";

export default async function ReviewPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  return <PlaceholderPage screen="review" subject={ideaId} />;
}
