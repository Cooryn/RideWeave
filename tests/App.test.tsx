import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Ride } from "../src/types";
const data = vi.hoisted(() => ({ rides: [] as Ride[] }));
vi.mock("../src/storage", () => ({
  desktop: true,
  loadRides: async () => [...data.rides],
  saveRide: async (ride: Ride) => {
    if (data.rides.some((r) => r.id === ride.id)) return false;
    data.rides.push(ride);
    return true;
  },
  renameRide: async (id: string, name: string) => {
    data.rides = data.rides.map((r) => (r.id === id ? { ...r, name } : r));
  },
  deleteRide: async (id: string) => {
    data.rides = data.rides.filter((r) => r.id !== id);
  },
}));
vi.mock("../src/Map", () => ({
  default: ({ rides }: { rides: Ride[] }) => (
    <div data-testid="map">{rides.map((r) => r.name).join(",")}</div>
  ),
}));
const windowApi = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));
import App from "../src/App";
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.rides = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const click = async (text: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
};
const raw =
  '<gpx><trk><name>测试路线</name><trkseg><trkpt lat="30" lon="120"><time>2026-10-01T00:00:00Z</time></trkpt><trkpt lat="30.01" lon="120.01"><time>2026-10-01T01:00:00Z</time></trkpt></trkseg></trk></gpx>';
it("imports a mixed batch, reports duplicates/errors, hides routes and deletes with updated stats", async () => {
  const file = (name: string, content: string) => ({
    name,
    size: content.length,
    text: async () => content,
  });
  const input = container.querySelector("input[type=file]")!;
  Object.defineProperty(input, "files", {
    value: [
      file("one.gpx", raw),
      file("copy.gpx", raw),
      file("bad.gpx", "<gpx/>"),
    ],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(container.textContent).toContain("新增 1 条，重复 1 条，失败 1 条");
  expect(data.rides).toHaveLength(1);
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe(
    "测试路线",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="隐藏 测试路线"]')!
      .click(),
  );
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe("");
  await click("全部轨迹");
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe(
    "测试路线",
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".ride-main")!.click(),
  );
  expect(container.textContent).toContain("平均速度 = GPS 距离 ÷ 记录经过时间");
  await click("删除");
  expect(data.rides).toHaveLength(1);
  await click("确认删除");
  expect(data.rides).toHaveLength(0);
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe("");
  expect(container.querySelectorAll(".stat-card strong")[1].textContent).toBe(
    "0次",
  );
});

it("uses integrated window controls and reports native failures", async () => {
  for (const [label, method] of [
    ["最小化窗口", "minimize"],
    ["最大化窗口", "toggleMaximize"],
    ["关闭窗口", "close"],
  ] as const) {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .click(),
    );
    expect(windowApi[method]).toHaveBeenCalled();
  }
  windowApi.minimize.mockRejectedValueOnce(new Error("denied"));
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="最小化窗口"]')!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "窗口操作失败",
  );
  expect(
    container.querySelector("header[data-tauri-drag-region]"),
  ).not.toBeNull();
});
