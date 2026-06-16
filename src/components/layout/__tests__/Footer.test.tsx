import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Footer from "../Footer";

describe("Footer Component", () => {
  it("renders correctly", () => {
    // Mock the current year to prevent snapshot mismatches over time
    const mockDate = new Date("2026-06-16T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    const { asFragment } = render(<Footer />);
    expect(asFragment()).toMatchSnapshot();

    vi.useRealTimers();
  });
});
