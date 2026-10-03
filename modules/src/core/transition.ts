import { and, eq, getTableName, inArray } from "@rc/db/orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "@rc/db/pg-core";
import { InvalidStateError, NotFoundError } from "@rc/lib/errors";
import { audit } from "./audit";
import { type ServiceContext, withTransaction } from "./context";

/** Any table with an `id` column and a status column (`status` unless `statusKey` says otherwise). */
export type StatusTable<K extends string = "status"> = PgTable & { id: PgColumn } & Record<
    K,
    PgColumn
  >;
type StatusOf<T extends StatusTable<K>, K extends string> = T[K]["_"]["data"];

export type TransitionInput<T extends StatusTable<K>, K extends string = "status"> = {
  table: T;
  /** Property name of the status column; default `status` (e.g. `processingStatus`). */
  statusKey?: K;
  id: string;
  /** Statuses the row may be in; anything else → InvalidStateError. */
  from: readonly StatusOf<T, K>[];
  to: StatusOf<T, K>;
  /** Other columns to change in the same UPDATE. */
  set?: Omit<PgUpdateSetSource<T>, K>;
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
export function transition<T extends StatusTable<K>, K extends string = "status">(
  ctx: ServiceContext,
  input: TransitionInput<T, K>,
): Promise<T["$inferSelect"]> {
  const { table, id, from, to } = input;
  const statusKey = (input.statusKey ?? "status") as K;
  const statusColumn = table[statusKey] as PgColumn;
  const tableName = getTableName(table);
  const entityType = input.audit?.entityType ?? tableName;

  return withTransaction(ctx, async (tx) => {
    const [current] = (await tx.db
      .select({ status: statusColumn })
      .from(table as PgTable)
      .where(eq(table.id, id))
      .for("update")) as { status: StatusOf<T, K> }[];
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

    const values = { ...input.set, [statusKey]: to } as PgUpdateSetSource<T>;
    const [row] = (await tx.db
      .update(table)
      .set(values)
      .where(and(eq(table.id, id), inArray(statusColumn, [...from])))
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
