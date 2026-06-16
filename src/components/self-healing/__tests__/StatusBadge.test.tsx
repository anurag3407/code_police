import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../StatusBadge";
import type { HealingStatus } from "@/types";

describe("StatusBadge Component", () => {
  const statuses: HealingStatus[] = [
    "queued",
    "cloning",
    "scanning",
    "testing",
    "fixing",
    "pushing",
    "completed",
    "partial_success",
    "failed",
  ];

  statuses.forEach((status) => {
    it(`renders correctly for status: ${status}`, () => {
      const { asFragment } = render(<StatusBadge status={status} />);
      expect(asFragment()).toMatchSnapshot();
    });
  });
});
