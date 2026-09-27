import { PlaceholderPage } from "@/components/shell/placeholder";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceholderPage screen="source" subject={id} />;
}
