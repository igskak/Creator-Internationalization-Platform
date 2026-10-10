import { schema } from "@rc/db";
import { and, eq } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import type { ServiceContext } from "../../core";

/** A reason code is an active taxonomy term of kind `reason_code`. */
export async function assertReasonCode(ctx: ServiceContext, reasonCode: string): Promise<void> {
  const [reason] = await ctx.db
    .select({ code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(
      and(
        eq(schema.taxonomyTerms.kind, "reason_code"),
        eq(schema.taxonomyTerms.code, reasonCode),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    );
  if (!reason) {
    throw new ValidationError(`"${reasonCode}" is not a reason code.`, {
      fieldErrors: { reasonCode: [`"${reasonCode}" is not a reason code.`] },
    });
  }
}
