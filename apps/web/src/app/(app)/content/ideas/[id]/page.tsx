import { PlaceholderPage } from "@/components/shell/placeholder";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceholderPage screen="idea" subject={id} />;
}
