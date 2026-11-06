// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Ride, RidePreviewPoint } from "../src/types";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
const data = vi.hoisted(() => ({
  mobile: false,
  rides: [] as Ride[],
  deleteError: "",
}));
vi.mock("../src/storage", () => ({
  nativeApp: true,
  get android() {
    return data.mobile;
  },
  loadOriginalGpx: async () => null,
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
    previewPoint,
    active,
  }: {
    rides: Ride[];
    selected: string | null;
    roadMode: "route" | "heat";
    onRoadModeChange: (mode: "route" | "heat") => void;
    previewPoint?: RidePreviewPoint | null;
    active?: boolean;
  }) => (
    <>
      <div
        data-testid="map"
        data-selected={selected ?? ""}
        data-mode={roadMode}
        data-active={active}
        data-preview={
          previewPoint ? `${previewPoint.lon},${previewPoint.lat}` : ""
        }
      >
        {rides.map((r) => r.name).join(",")}
      </div>
      <button onClick={() => onRoadModeChange("route")}>骑行路线</button>
      <button onClick={() => onRoadModeChange("heat")}>骑行热区</button>
    </>
  ),
}));
import App from "../src/App";
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.mobile = false;
  data.rides = [];
  data.deleteError = "";
  vi.mocked(invoke).mockReset();
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
it("keeps recent rides at their original scroll position after scrolling and closing details", async () => {
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
  const open = async () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>(".ride-list .ride-main")!
        .click(),
    );
  const close = async () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!
        .click(),
    );

  for (const position of [0, 180]) {
    const list = container.querySelector<HTMLDivElement>(".ride-list")!;
    list.scrollTop = position;
    await open();
    const detail = container.querySelector<HTMLDivElement>(".detail")!;
    expect(detail.scrollTop).toBe(0);
    detail.scrollTop = 320;
    await close();
    expect(
      container.querySelector<HTMLDivElement>(".ride-list")!.scrollTop,
    ).toBe(position);
  }
});
const raw =
  '<gpx><trk><name>测试路线</name><trkseg><trkpt lat="30" lon="120"><time>2026-10-01T00:00:00Z</time></trkpt><trkpt lat="30.01" lon="120.01"><time>2026-10-01T01:00:00Z</time></trkpt></trkseg></trk></gpx>';
it("keeps the same map mounted through sidebar navigation and preserves its mode through theme changes", async () => {
  const originalMap = container.querySelector('[data-testid="map"]')!;
  const workspace = originalMap.closest<HTMLDivElement>(".map-layout")!;
  const mode = () =>
    container.querySelector('[data-testid="map"]')?.getAttribute("data-mode");
  expect(mode()).toBe("heat");
  for (const choice of ["骑行路线", "骑行热区"]) {
    await click(choice);
    const expected = choice === "骑行路线" ? "route" : "heat";
    for (const page of ["历史记录", "数据统计", "设置"]) {
      await click(page);
      expect(container.querySelector('[data-testid="map"]')).toBe(originalMap);
      expect(workspace.hidden).toBe(true);
      expect(originalMap.getAttribute("data-active")).toBe("false");
      expect(container.querySelector(".ride-panel")).toBeNull();
      await click("骑行地图");
      expect(container.querySelector('[data-testid="map"]')).toBe(originalMap);
      expect(workspace.hidden).toBe(false);
      expect(originalMap.getAttribute("data-active")).toBe("true");
      expect(mode()).toBe(expected);
    }
    await click("设置");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".header-actions > button")!
        .click(),
    );
    await click("骑行地图");
    expect(container.querySelector('[data-testid="map"]')).toBe(originalMap);
    expect(mode()).toBe(expected);
  }
});
it("shows independent statistics for all saved rides and opens records while retaining the map and period", async () => {
  const year = new Date().getFullYear();
  const fixture: Ride = {
    id: "current-year",
    name: "本年路线",
    date: new Date().toISOString(),
    distance: 10,
    duration: 3600,
    segments: [],
    filename: "synthetic.gpx",
    importedAt: "",
  };
  data.rides = [
    fixture,
    {
      ...fixture,
      id: "last-year",
      name: "往年路线",
      distance: 20,
      date: new Date(year - 1, 0, 1).toISOString(),
    },
  ];
  await act(async () => root.render(null));
  await act(async () => root.render(<App />));
  const map = container.querySelector('[data-testid="map"]')!;
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="隐藏 本年路线"]')!
      .click(),
  );
  expect(map.textContent).toBe("往年路线");
  await click("数据统计");
  expect(container.querySelector(".stats-grid")).toBeNull();
  expect(
    container.querySelector(
      '[aria-label="统计时间范围"] button[aria-pressed="true"]',
    )?.textContent,
  ).toBe("近30天");
  expect(
    container.querySelector(".analytics-mileage > strong")?.textContent,
  ).toBe("10.0km");
  await click("全部");
  expect(
    container.querySelector(".analytics-mileage > strong")?.textContent,
  ).toBe("30.0km");
  await click("今年");
  expect(
    container.querySelector(".analytics-mileage > strong")?.textContent,
  ).toBe("10.0km");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="查看最远一次：本年路线"]',
      )!
      .click(),
  );
  expect(container.querySelector('[data-testid="map"]')).toBe(map);
  expect(map.getAttribute("data-selected")).toBe("current-year");
  expect(map.textContent).toContain("本年路线");
  await click("数据统计");
  expect(
    container.querySelector('.analytics-switch button[aria-pressed="true"]')
      ?.textContent,
  ).toBe("今年");
  await act(async () => root.render(null));
  await act(async () => root.render(<App />));
  await click("数据统计");
  expect(
    container.querySelector(
      '[aria-label="统计时间范围"] button[aria-pressed="true"]',
    )?.textContent,
  ).toBe("近30天");
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
  expect(container.querySelector(".ride-charts")).not.toBeNull();
  const svg = container.querySelector<SVGSVGElement>(".ride-chart-plot svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 320,
  } as DOMRect);
  await act(async () =>
    svg.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 314 }),
    ),
  );
  expect(
    container
      .querySelector('[data-testid="map"]')
      ?.getAttribute("data-preview"),
  ).toBe("120.01,30.01");
  await act(async () =>
    svg.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })),
  );
  expect(
    container
      .querySelector('[data-testid="map"]')
      ?.getAttribute("data-preview"),
  ).toBe("");
  const progress = container.querySelector<HTMLInputElement>(
    '[aria-label="轨迹播放进度"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(progress, "3600");
    progress.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    container
      .querySelector('[data-testid="map"]')
      ?.getAttribute("data-preview"),
  ).toBe("120.01,30.01");
  const retainedMap = container.querySelector('[data-testid="map"]');
  await click("历史记录");
  expect(container.querySelector(".ride-charts")).toBeNull();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(retainedMap?.getAttribute("data-preview")).toBe("");
  await click("骑行地图");
  expect(container.querySelector('[data-testid="map"]')).toBe(retainedMap);
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="轨迹播放进度"]')!
      .value,
  ).toBe("0");
  await click("删除");
  expect(data.rides).toHaveLength(1);
  await click("确认删除");
  expect(data.rides).toHaveLength(0);
  expect(container.querySelector("[data-testid=map]")?.textContent).toBe("");
  expect(container.querySelector(".ride-charts")).toBeNull();
  expect(container.querySelectorAll(".stat-card strong")[1].textContent).toBe(
    "0次",
  );
});

it("applies and remembers explicit settings themes and keeps them in sync with the titlebar", async () => {
  await click("设置");
  expect(
    container.querySelector('[aria-label="应用设置"]')?.textContent,
  ).toContain("0 条记录");
  const choose = async (theme: string) =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[aria-label="使用${theme}主题"]`)!
        .click(),
    );
  await choose("浅色");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("rideweave-theme")).toBe("light");
  expect(
    container
      .querySelector('[aria-label="使用浅色主题"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '.header-actions > button[title="切换深色"]',
      )!
      .click(),
  );
  expect(
    container
      .querySelector('[aria-label="使用深色主题"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await choose("浅色");
  await click("骑行地图");
  await click("设置");
  expect(
    container
      .querySelector('[aria-label="使用浅色主题"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  await act(async () => root.render(null));
  await act(async () => root.render(<App />));
  expect(document.documentElement.dataset.theme).toBe("light");
  await click("设置");
  expect(
    container
      .querySelector('[aria-label="使用浅色主题"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
});

it("retargets rapid theme changes and cleans up the transition after completion or unmount", async () => {
  await act(async () => root.render(null));
  vi.useFakeTimers();
  try {
    await act(async () => root.render(<App />));
    const map = container.querySelector('[data-testid="map"]');
    const originalTheme = document.documentElement.dataset.theme;
    const toggle = async () =>
      act(async () =>
        container.querySelector<HTMLButtonElement>(".theme-toggle")!.click(),
      );
    await toggle();
    expect(document.documentElement.classList.contains("theme-changing")).toBe(
      true,
    );
    await act(async () => vi.advanceTimersByTime(180));
    await toggle();
    await act(async () => vi.advanceTimersByTime(140));
    expect(document.documentElement.classList.contains("theme-changing")).toBe(
      true,
    );
    expect(document.documentElement.dataset.theme).toBe(originalTheme);
    expect(localStorage.getItem("rideweave-theme")).toBe(originalTheme);
    expect(container.querySelector('[data-testid="map"]')).toBe(map);
    await act(async () => vi.advanceTimersByTime(180));
    expect(document.documentElement.classList.contains("theme-changing")).toBe(
      false,
    );
    await toggle();
    await act(async () => root.render(null));
    expect(document.documentElement.classList.contains("theme-changing")).toBe(
      false,
    );
  } finally {
    vi.useRealTimers();
  }
});

it("imports Android shares, handles system back and merges a selected backup", async () => {
  await act(async () => root.render(null));
  data.mobile = true;
  let shared = [
    { token: "a", name: "骑行.gpx" },
    { token: "b", name: "副本.gpx" },
    { token: "invalid", name: "不支持.txt" },
    { token: "large", name: "过大.gpx", size: 50 * 1024 * 1024 + 1 },
  ];
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "take_shared_gpx") {
      const files = shared;
      shared = [];
      return files as never;
    }
    if (command === "read_shared_gpx")
      return new TextEncoder().encode(raw).buffer as never;
    if (command === "restore_backup")
      return { added: 0, duplicates: 1 } as never;
    return undefined as never;
  });
  await act(async () => root.render(<App />));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain("新增 1 条，重复 1 条，失败 2 条");
  });
  expect(container.querySelector(".android-app")).not.toBeNull();
  expect(container.querySelector(".window-controls")).toBeNull();
  expect(
    container.querySelector<HTMLInputElement>('input[type="file"]')?.multiple,
  ).toBe(true);
  expect(data.rides).toHaveLength(1);
  expect(
    vi.mocked(invoke).mock.calls.filter(([name]) => name === "read_shared_gpx"),
  ).toHaveLength(2);

  const back = () =>
    act(async () => window.dispatchEvent(new Event("rideweave-back")));
  await click("设置");
  await click("恢复备份");
  await back();
  expect(container.textContent).not.toContain("选择备份文件");
  await click("恢复备份");
  await click("选择备份文件");
  expect(container.textContent).toContain("恢复完成：新增 0 条，重复 1 条");
  await back();
  expect(container.querySelector("h1")?.textContent).toBe("骑行地图");
});
