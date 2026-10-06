"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RowColumn<R> = {
  key: keyof R & string;
  label: string;
  placeholder?: string;
  /** Options for a select; plain text input otherwise. */
  options?: readonly string[];
  width?: string;
  /** Client-side check shown under the cell (server validation still applies). */
  validate?: (value: string, row: R) => string | null;
};

/** Small table editor for JSON arrays of flat string objects (vocabulary, patterns, hypotheses). */
export function RowsEditor<R extends Record<string, string>>({
  rows,
  columns,
  onChange,
  newRow,
  disabled,
  errorsForRow,
  addLabel,
  emptyLabel = "None yet.",
  removeLabel = "Remove row",
}: {
  rows: R[];
  columns: RowColumn<R>[];
  onChange: (rows: R[]) => void;
  newRow: () => R;
  disabled?: boolean;
  errorsForRow?: (index: number) => string[];
  addLabel: string;
  /** Shown when there are no rows (default in English). */
  emptyLabel?: string;
  /** Accessible name of the remove button; the row number is added (default in English). */
  removeLabel?: string;
}) {
  const update = (index: number, key: keyof R, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{emptyLabel}</p>}
      {rows.map((row, index) => {
        const rowErrors = errorsForRow?.(index) ?? [];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order is the identity
          <div key={index} className="flex flex-col gap-1 rounded-md border p-2">
            <div className="flex flex-wrap items-end gap-2">
              {columns.map((column) => {
                const value = row[column.key] ?? "";
                const problem = column.validate?.(value, row);
                const id = `${column.key}-${index}`;
                const name = `${column.label} ${index + 1}`;
                return (
                  <label
                    key={column.key}
                    htmlFor={id}
                    className={`flex flex-col gap-1 text-xs ${column.width ?? "min-w-40 flex-1"}`}
                  >
                    <span className="text-muted-foreground">{column.label}</span>
                    {column.options ? (
                      <select
                        id={id}
                        aria-label={name}
                        value={value}
                        disabled={disabled}
                        onChange={(e) => update(index, column.key, e.target.value)}
                        className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                      >
                        {column.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={id}
                        aria-label={name}
                        value={value}
                        placeholder={column.placeholder}
                        disabled={disabled}
                        aria-invalid={problem ? true : undefined}
                        onChange={(e) => update(index, column.key, e.target.value)}
                      />
                    )}
                    {problem && <span className="text-destructive">{problem}</span>}
                  </label>
                );
              })}
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${removeLabel} ${index + 1}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
            {rowErrors.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                {rowErrors.join(" · ")}
              </p>
            )}
          </div>
        );
      })}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...rows, newRow()])}
        >
          <PlusIcon /> {addLabel}
        </Button>
      )}
    </div>
  );
}
