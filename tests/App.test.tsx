import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Ride } from "../src/types";
const data = vi.hoisted(() => ({ rides: [] as Ride[], deleteError: "" }));
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
    if (data.deleteError) throw new Error(data.deleteError);
    data.rides = data.rides.filter((r) => r.id !== id);
  },
}));
vi.mock("../src/Map", () => ({
  default: ({
    rides,
    selected,
    roadMode,
    onRoadModeChange,
  }: {
    rides: Ride[];
    selected: string | null;
    roadMode: "route" | "heat";
    onRoadModeChange: (mode: "route" | "heat") => void;
  }) => (
    <>
      <div
        data-testid="map"
        data-selected={selected ?? ""}
        data-mode={roadMode}
      >
        {rides.map((r) => r.name).join(",")}
      </div>
      <button onClick={() => onRoadModeChange("route")}>骑行路线</button>
      <button onClick={() => onRoadModeChange("heat")}>骑行热区</button>
    </>
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
const setNativeBackground = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ setBackgroundColor: setNativeBackground }),
}));
import App from "../src/App";
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.rides = [];
  data.deleteError = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

it("deletes from recent/history lists with cancellation, failure recovery and selection preservation", async () => {
  const fixture: Ride = {
    id: "one",
    name: "第一条",
    date: null,
    distance: 1,
    duration: null,
    segments: [],
    filename: "one.gpx",
    importedAt: "",
  };
  data.rides = [fixture, { ...fixture, id: "two", name: "第二条" }];
  await act(async () => root.render(null));
  await act(async () => root.render(<App />));
  const byLabel = async (label: string) =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
        .click(),
    );
  await byLabel("删除 第一条");
  expect(container.textContent).toContain("删除“第一条”");
  await click("取消");
  expect(data.rides).toHaveLength(2);
  await act(async () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>(".ride-main"))
      .find((b) => b.textContent?.includes("第二条"))!
      .click(),
  );
  await click("历史记录");
  await byLabel("删除 第一条");
  data.deleteError = "数据库写入失败";
  await click("确认删除");
  expect(data.rides).toHaveLength(2);
  expect(container.textContent).toContain("删除失败");
  expect(container.querySelectorAll(".ride-row")).toHaveLength(2);
  data.deleteError = "";
  await click("确认删除");
  expect(data.rides.map((r) => r.id)).toEqual(["two"]);
  expect(container.querySelectorAll(".ride-row")).toHaveLength(1);
  await click("骑行地图");
  expect(
    container.querySelector("[data-testid=map]")?.getAttribute("data-selected"),
  ).toBe("two");
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe(
    "第二条",
  );
  await click("历史记录");
  await byLabel("删除 第二条");
  await click("确认删除");
  await click("骑行地图");
  expect(data.rides).toHaveLength(0);
  expect(
    container.querySelector("[data-testid=map]")?.getAttribute("data-selected"),
  ).toBe("");
  expect(container.querySelectorAll(".stat-card strong")[1].textContent).toBe(
    "0次",
  );
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
it("preserves the chosen map display mode through every sidebar page and theme changes", async () => {
  const mode = () =>
    container.querySelector('[data-testid="map"]')?.getAttribute("data-mode");
  expect(mode()).toBe("heat");
  for (const choice of ["骑行路线", "骑行热区"]) {
    await click(choice);
    const expected = choice === "骑行路线" ? "route" : "heat";
    for (const page of ["历史记录", "数据统计", "设置"]) {
      await click(page);
      expect(container.querySelector('[data-testid="map"]')).toBeNull();
      await click("骑行地图");
      expect(mode()).toBe(expected);
    }
    await click("设置");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".header-actions > button")!
        .click(),
    );
    await click("骑行地图");
    expect(mode()).toBe(expected);
  }
});
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
  expect(
    container.querySelectorAll(".detail-metrics strong")[1].textContent,
  ).toBe("1h 0min");
  expect(container.textContent).not.toContain(
    "经过时间含停留，缺少完整时间时不计算速度。",
  );
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

it("keeps native window and webview background aligned with the selected theme", async () => {
  const initialDark = document.documentElement.dataset.theme === "dark";
  expect(setNativeBackground).toHaveBeenLastCalledWith(
    initialDark ? "#080b0c" : "#f2f3f5",
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".header-actions > button")!
      .click(),
  );
  expect(setNativeBackground).toHaveBeenLastCalledWith(
    initialDark ? "#f2f3f5" : "#080b0c",
  );
});
