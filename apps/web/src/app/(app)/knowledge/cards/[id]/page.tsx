import { PlaceholderPage } from "@/components/shell/placeholder";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceholderPage screen="card" subject={id} />;
}
