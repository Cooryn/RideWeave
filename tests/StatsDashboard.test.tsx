// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StatsDashboard from "../src/StatsDashboard";
import type { StatsPeriod } from "../src/rideAnalytics";
import type { Ride } from "../src/types";

const ride = (id: string, distance: number, date: string | null): Ride => ({
  id,
  name: id,
  date,
  distance,
  duration: 3600,
  segments: [],
  filename: `${id}.gpx`,
  importedAt: "",
});
const fixtures = [
  ride("本次骑行", 10, new Date(2026, 9, 29, 8).toISOString()),
  ride("春季长途", 50, new Date(2026, 2, 1, 8).toISOString()),
  ride("去年骑行", 80, new Date(2025, 11, 31, 8).toISOString()),
];
const select = vi.fn();
function Harness({ rides }: { rides: Ride[] }) {
  const [period, setPeriod] = useState<StatsPeriod>("all");
  return (
    <StatsDashboard
      rides={rides}
      period={period}
      onPeriodChange={setPeriod}
      onSelect={select}
    />
  );
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 29, 12));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  select.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
};
const mileage = () =>
  container.querySelector(".analytics-mileage > strong")?.textContent;

it("switches periods and trend metrics, previews buckets and opens the correct record", async () => {
  await act(async () => root.render(<Harness rides={fixtures} />));
  expect(mileage()).toBe("140.0km");
  expect(container.querySelector(".stats-grid")).toBeNull();
  await click("近30天");
  expect(mileage()).toBe("10.0km");
  await click("今年");
  expect(mileage()).toBe("60.0km");
  await click("次数");
  expect(container.querySelector(".analytics-trend h2")?.textContent).toBe(
    "次数趋势",
  );
  const bucket = container.querySelector<HTMLButtonElement>(
    '.analytics-bars button[aria-label^="2026/3："]',
  )!;
  await act(async () => bucket.focus());
  expect(container.querySelector(".analytics-trend-summary")?.textContent).toBe(
    "2026/31 次",
  );
  await act(async () => bucket.blur());
  expect(container.querySelector(".analytics-trend-summary")?.textContent).toBe(
    "今年2 次",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="查看最远一次：春季长途"]',
      )!
      .click(),
  );
  expect(select).toHaveBeenLastCalledWith("春季长途");
});

it("handles empty ranges, unknown dates/times and zero speeds without fabricated data", async () => {
  await act(async () => root.render(<Harness rides={[]} />));
  expect(container.textContent).toContain("还没有可统计的骑行");
  await act(async () =>
    root.render(
      <Harness rides={[{ ...fixtures[0], date: null, duration: null }]} />,
    ),
  );
  expect(container.textContent).toContain("记录中没有有效日期");
  expect(
    container
      .querySelector('[aria-label="最快均速暂无数据"]')
      ?.hasAttribute("disabled"),
  ).toBe(true);
  await click("近30天");
  expect(container.textContent).toContain("这个时间范围内还没有骑行记录");
  expect(container.textContent).toContain("1 条记录没有有效日期");
  await click("查看全部记录");
  expect(mileage()).toBe("10.0km");
  await act(async () =>
    root.render(<Harness rides={[{ ...fixtures[0], distance: 0 }]} />),
  );
  expect(
    container.querySelector(".analytics-highlights strong")?.textContent,
  ).toBe("0.0km/h");
});

it("updates totals and records after a ride is deleted without retaining an old bucket preview", async () => {
  await act(async () => root.render(<Harness rides={fixtures} />));
  const bucket = container.querySelector<HTMLButtonElement>(
    ".analytics-bars button:last-child",
  )!;
  await act(async () => bucket.focus());
  await act(async () => root.render(<Harness rides={[fixtures[0]]} />));
  expect(mileage()).toBe("10.0km");
  expect(
    container.querySelector('[aria-label="查看最远一次：本次骑行"]'),
  ).not.toBeNull();
  expect(
    container.querySelector(".analytics-trend-summary")?.textContent,
  ).toContain("10.0");
});
