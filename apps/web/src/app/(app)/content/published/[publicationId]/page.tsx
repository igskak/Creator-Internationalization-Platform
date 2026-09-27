import { PlaceholderPage } from "@/components/shell/placeholder";

export default async function LineagePage({
  params,
}: {
  params: Promise<{ publicationId: string }>;
}) {
  const { publicationId } = await params;
  return <PlaceholderPage screen="lineage" subject={publicationId} />;
}
