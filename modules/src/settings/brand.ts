import { schema } from "@rc/db";
import { VisualSystem } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../core";

export type Brand = typeof schema.brands.$inferSelect;

export async function getBrand(ctx: ServiceContext): Promise<Brand> {
  const [brand] = await ctx.db
    .select()
    .from(schema.brands)
    .orderBy(schema.brands.createdAt)
    .limit(1);
  if (!brand) throw new NotFoundError("No brand configured. Run pnpm db:seed.");
  return brand;
}

export const UpdateBrandInput = z.object({
  brandId: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  brandVoice: z.string().max(50_000).optional(),
  /** Parsed JSON; validated against VisualSystem in the service. */
  visualSystem: z.unknown().optional(),
});
export type UpdateBrandInput = z.input<typeof UpdateBrandInput>;

/** 05 §5.2 updateBrand (owner). The visual system must match VisualSystem; audit `brand.updated`. */
export async function updateBrand(ctx: ServiceContext, raw: UpdateBrandInput): Promise<Brand> {
  const input = UpdateBrandInput.parse(raw);
  const changes: Partial<typeof schema.brands.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description;
  if (input.brandVoice !== undefined) changes.brandVoice = input.brandVoice;
  if (input.visualSystem !== undefined) {
    const parsed = VisualSystem.safeParse(input.visualSystem);
    if (!parsed.success) {
      const error = ValidationError.fromZod(parsed.error, "The visual system is invalid.");
      const fieldErrors = Object.fromEntries(
        Object.entries(error.fieldErrors ?? {}).map(([path, messages]) => [
          path === "_form" ? "visualSystem" : `visualSystem.${path}`,
          messages,
        ]),
      );
      throw new ValidationError("The visual system is invalid.", {
        fieldErrors,
        cause: parsed.error,
      });
    }
    changes.visualSystem = parsed.data;
  }

  return withTransaction(ctx, async (tx) => {
    const [brand] = await tx.db
      .update(schema.brands)
      .set(changes)
      .where(eq(schema.brands.id, input.brandId))
      .returning();
    if (!brand)
      throw new NotFoundError("Brand not found.", { details: { brandId: input.brandId } });
    await audit(tx, {
      action: "brand.updated",
      entityType: "brand",
      entityId: brand.id,
      data: { fields: Object.keys(changes) },
    });
    return brand;
  });
}
