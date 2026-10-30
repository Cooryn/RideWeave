// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Ride, RidePreviewPoint } from "../src/types";
import type { DragDropEvent } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
const data = vi.hoisted(() => ({
  rides: [] as Ride[],
  deleteError: "",
  pendingLoad: null as Promise<Ride[]> | null,
}));
vi.mock("../src/storage", () => ({
  desktop: true,
  loadOriginalGpx: async () => null,
  loadRides: async () => data.pendingLoad ?? [...data.rides],
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
const windowApi = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
}));
const fileDrop = vi.hoisted(() => ({
  handler: null as ((event: { payload: DragDropEvent }) => void) | null,
  unlisten: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setBackgroundColor: async () => {},
    onDragDropEvent: fileDrop.subscribe,
  }),
}));
import App from "../src/App";
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.rides = [];
  data.deleteError = "";
  data.pendingLoad = null;
  fileDrop.handler = null;
  fileDrop.unlisten.mockReset();
  fileDrop.subscribe.mockReset().mockImplementation(async (handler) => {
    fileDrop.handler = handler;
    return fileDrop.unlisten;
  });
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
const drag = async (payload: DragDropEvent) =>
  act(async () => fileDrop.handler!({ payload }));
const location = new PhysicalPosition(20, 30);
it("imports native drops from any page through the same deduplication and partial-failure flow", async () => {
  await click("历史记录");
  const paths = [
    "C:\\rides\\one.GPX",
    "C:\\rides\\copy.gpx",
    "C:\\rides\\bad.gpx",
    "C:\\rides\\image.png",
    "C:\\rides\\large.gpx",
    "C:\\rides\\missing.gpx",
  ];
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    const path = (args as { path: string }).path;
    if (path.endsWith("large.gpx")) throw new Error("文件超过 50 MB 限制");
    if (path.endsWith("missing.gpx")) throw new Error("无法打开文件");
    return path.endsWith("bad.gpx") ? "<gpx/>" : raw;
  });
  await drag({ type: "enter", paths, position: location });
  expect(container.querySelector(".gpx-drop-overlay")?.textContent).toContain(
    "松开以导入 GPX",
  );
  await drag({ type: "over", position: location });
  expect(invoke).not.toHaveBeenCalled();
  await drag({ type: "leave" });
  expect(container.querySelector(".gpx-drop-overlay")).toBeNull();
  await drag({ type: "enter", paths, position: location });
  await act(async () => {
    fileDrop.handler!({
      payload: {
        type: "drop",
        paths: [...paths, paths[0]],
        position: location,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(container.querySelector(".gpx-drop-overlay")).toBeNull();
  expect(container.querySelector("h1")?.textContent).toBe("历史记录");
  expect(container.textContent).toContain("新增 1 条，重复 1 条，失败 4 条");
  expect(container.textContent).toContain("image.png：仅支持 GPX 文件");
  expect(container.textContent).toContain("large.gpx：");
  expect(data.rides).toHaveLength(1);
  expect(invoke).toHaveBeenCalledTimes(5);
  expect(invoke).toHaveBeenCalledWith("read_dropped_gpx", { path: paths[0] });
  expect(fileDrop.subscribe).toHaveBeenCalledOnce();
});

it("rejects additional drops while importing and accepts another batch after completion", async () => {
  let resolveRead!: (text: string) => void;
  vi.mocked(invoke).mockReturnValueOnce(
    new Promise<string>((resolve) => {
      resolveRead = resolve;
    }),
  );
  const drop = {
    type: "drop",
    paths: ["C:\\rides\\one.gpx"],
    position: location,
  } as const;
  await drag({ ...drop, paths: [...drop.paths] });
  await click("设置");
  await drag({ type: "enter", paths: [...drop.paths], position: location });
  expect(container.querySelector(".gpx-drop-overlay")?.textContent).toContain(
    "正在处理文件",
  );
  await drag({ ...drop, paths: [...drop.paths] });
  expect(container.textContent).toContain("正在处理文件，请完成后再次拖入");
  expect(invoke).toHaveBeenCalledOnce();
  await act(async () => {
    resolveRead(raw);
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(data.rides).toHaveLength(1);
  vi.mocked(invoke).mockResolvedValueOnce(raw);
  await act(async () => {
    fileDrop.handler!({ payload: { ...drop, paths: [...drop.paths] } });
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(container.textContent).toContain("新增 0 条，重复 1 条，失败 0 条");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("waits for database readiness before reading any dropped file", async () => {
  let resolveLoad!: (rides: Ride[]) => void;
  data.pendingLoad = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  await act(async () => root.render(null));
  await act(async () => root.render(<App />));
  const drop = {
    type: "drop",
    paths: ["/synthetic/one.gpx"],
    position: location,
  } as const;
  await drag({ ...drop, paths: [...drop.paths] });
  expect(container.textContent).toContain("本地数据尚未就绪");
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => {
    data.pendingLoad = null;
    resolveLoad([]);
  });
  vi.mocked(invoke).mockResolvedValue(raw);
  await act(async () => {
    fileDrop.handler!({ payload: { ...drop, paths: [...drop.paths] } });
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(data.rides).toHaveLength(1);
  expect(container.textContent).toContain("新增 1 条，重复 0 条，失败 0 条");
});

it("reports unavailable native drop handling and cleans up subscriptions that resolve after unmount", async () => {
  await act(async () => root.render(null));
  expect(fileDrop.unlisten).toHaveBeenCalledOnce();
  fileDrop.subscribe.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => root.render(<App />));
  expect(container.textContent).toContain(
    "拖入导入暂不可用，请使用“导入 GPX”按钮",
  );
  expect(
    container.querySelector<HTMLButtonElement>(".page-heading .primary")
      ?.disabled,
  ).toBe(false);
  await act(async () => root.render(null));
  const unlisten = vi.fn();
  let resolveListener!: (callback: () => void) => void;
  fileDrop.subscribe.mockImplementationOnce((handler) => {
    fileDrop.handler = handler;
    return new Promise((resolve) => {
      resolveListener = resolve;
    });
  });
  await act(async () => root.render(<App />));
  await act(async () => root.render(null));
  await act(async () => {
    resolveListener(unlisten);
  });
  expect(unlisten).toHaveBeenCalledOnce();
  await drag({ type: "enter", paths: ["late.gpx"], position: location });
  expect(container.textContent).toBe("");
  expect(invoke).not.toHaveBeenCalled();
});

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
