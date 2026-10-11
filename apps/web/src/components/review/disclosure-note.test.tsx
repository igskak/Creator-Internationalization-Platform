// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { DisclosureNote } from "./disclosure-note";

afterEach(cleanup);

const show = (
  disclosure: Parameters<typeof DisclosureNote>[0]["disclosure"],
  locale: "en" | "ru" = "en",
) =>
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : ru}>
      <DisclosureNote disclosure={disclosure} />
    </I18nProvider>,
  );

describe("disclosure note", () => {
  it("shows nothing when nothing is added", () => {
    show(null);
    expect(screen.queryByTestId("disclosure-note")).not.toBeInTheDocument();
    cleanup();
    show({ mode: "NONE" });
    expect(screen.queryByTestId("disclosure-note")).not.toBeInTheDocument();
  });

  it("quotes the caption note", () => {
    show({ mode: "CAPTION_NOTE", captionNote: "Imágenes generadas con IA." });
    expect(screen.getByTestId("disclosure-note")).toHaveTextContent(
      "A note is added to the caption: “Imágenes generadas con IA.”",
    );
  });

  it("says what the badge and the label do, in both languages", () => {
    show({ mode: "SLIDE_BADGE", badge: true });
    expect(screen.getByTestId("disclosure-note")).toHaveTextContent("“AI” badge");
    cleanup();
    show({ mode: "PLATFORM_LABEL", platformLabel: true }, "ru");
    expect(screen.getByTestId("disclosure-note")).toHaveTextContent("метка Instagram");
  });
});
