"use client";

import { ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type FacetOption = { value: string; label: string; count: number };

/**
 * A filter drop-down: a button with the number of chosen values, and a list of values with the
 * count of cards behind each. Choosing a value applies it at once.
 */
export function FacetMenu({
  label,
  options,
  selected,
  onToggle,
  emptyText,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyText: string;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        {label}
        {selected.length > 0 ? <Badge variant="secondary">{selected.length}</Badge> : null}
        <ChevronDownIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1">
        {options.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {options.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={selected.includes(option.value)}
                    onChange={() => onToggle(option.value)}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
