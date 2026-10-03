"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { isActiveHref, type NavItem, type NavSection } from "./screens";

function ItemLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const note = item.note ? (
    <span className="ml-auto text-xs text-muted-foreground">{item.note}</span>
  ) : null;
  const icon = item.icon ? <span aria-hidden="true">{item.icon}</span> : null;
  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60"
      >
        {icon}
        {item.label}
        {note}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
        active && "bg-muted font-medium text-foreground",
      )}
    >
      {icon}
      {item.label}
      {note}
    </Link>
  );
}

/** Sidebar navigation (plan 10 §10.1). */
export function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { messages } = useI18n();
  return (
    <nav aria-label={messages.shell.mainNav} className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          {section.href ? (
            <ItemLink
              item={{ label: section.label, href: section.href }}
              active={isActiveHref(pathname, section.href)}
              {...(onNavigate ? { onNavigate } : {})}
            />
          ) : (
            <>
              <span className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </span>
              {section.items.map((item) => (
                <ItemLink
                  key={item.href}
                  item={item}
                  active={isActiveHref(pathname, item.href)}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              ))}
            </>
          )}
        </div>
      ))}
    </nav>
  );
}
