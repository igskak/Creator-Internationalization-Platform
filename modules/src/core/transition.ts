import { and, eq, getTableName, inArray } from "@rc/db/orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "@rc/db/pg-core";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { audit } from "./audit";
import { type ServiceContext, withTransaction } from "./context";

/** Any table with `id` and `status` columns. */
export type StatusTable = PgTable & { id: PgColumn; status: PgColumn };
type StatusOf<T extends StatusTable> = T["status"]["_"]["data"];

export type TransitionInput<T extends StatusTable> = {
  table: T;
  id: string;
  /** Statuses the row may be in; anything else → InvalidStateError. */
  from: readonly StatusOf<T>[];
  to: StatusOf<T>;
  /** Other columns to change in the same UPDATE. */
  set?: Omit<PgUpdateSetSource<T>, "status">;
  audit?: {
    /** Default `<table>.status_changed`. */
    action?: string;
    /** Default: the table name. */
    entityType?: string;
    marketId?: string;
    data?: Record<string, unknown>;
  };
};

/**
 * The only way to change a status (plan 04 §4.7 rule 6). In one transaction: lock the row, check
 * that its status is in `from`, run `update … where id = $id and status = any($from)`, and write
 * an audit event with the previous and new status. Throws NotFoundError or InvalidStateError.
 */
export function transition<T extends StatusTable>(
  ctx: ServiceContext,
  input: TransitionInput<T>,
): Promise<T["$inferSelect"]> {
  const { table, id, from, to } = input;
  const tableName = getTableName(table);
  const entityType = input.audit?.entityType ?? tableName;

  return withTransaction(ctx, async (tx) => {
    const [current] = (await tx.db
      .select({ status: table.status })
      .from(table as PgTable)
      .where(eq(table.id, id))
      .for("update")) as { status: StatusOf<T> }[];
    if (!current) {
      throw new NotFoundError(`${entityType} not found.`, { details: { entityType, id } });
    }
    const details = { entityType, id, from: current.status, allowedFrom: [...from], to };
    if (!from.includes(current.status)) {
      throw new InvalidStateError(
        `Cannot change ${entityType} from ${String(current.status)} to ${String(to)}.`,
        { details },
      );
    }

    const values = { ...input.set, status: to } as PgUpdateSetSource<T>;
    const [row] = (await tx.db
      .update(table)
      .set(values)
      .where(and(eq(table.id, id), inArray(table.status, [...from])))
      .returning()) as T["$inferSelect"][];
    if (!row) throw new InvalidStateError(`${entityType} changed concurrently.`, { details });

    await audit(tx, {
      action: input.audit?.action ?? `${tableName}.status_changed`,
      entityType,
      entityId: id,
      ...(input.audit?.marketId ? { marketId: input.audit.marketId } : {}),
      data: { ...input.audit?.data, from: current.status, to },
    });
    return row;
  });
}
