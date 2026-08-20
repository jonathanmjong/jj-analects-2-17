import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedTabs, segmentedTabId } from "./SegmentedTabs";

const OPTIONS = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
] as const;

function Harness({ onChange }: { onChange?: (next: string) => void }) {
  const [value, setValue] = useState<string>("one");
  return (
    <SegmentedTabs
      idBase="test"
      label="Test sections"
      options={OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      panelId="test-panel"
    />
  );
}

describe("SegmentedTabs", () => {
  it("exposes a tablist with one tab per option and marks the selected one", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["One", "Two", "Three"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
  });

  it("points only the selected tab at the panel that is actually rendered", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-controls")).toBe("test-panel");
    expect(tabs[1].getAttribute("aria-controls")).toBeNull();
  });

  it("keeps only the selected tab in the tab order (roving tabindex)", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Three" }));
    expect(onChange).toHaveBeenCalledWith("three");
    expect(screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves selection with the arrow keys and wraps around", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Two" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the ends with Home and End", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(screen.getByRole("tab", { name: "Three" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
  });

  it("ignores keys it does not handle", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "a" });
    expect(screen.getByRole("tab", { name: "One" }).getAttribute("aria-selected")).toBe("true");
  });

  it("gives each tab the id a panel can point back at", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Two" }).id).toBe(segmentedTabId("test", "two"));
  });
});
