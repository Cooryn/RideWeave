import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  Map,
  History,
  ChartNoAxesCombined,
  Settings,
  Download,
  ArrowUpRight,
  Route,
  Clock3,
  Mountain,
  X,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  LocateFixed,
  Sun,
  Moon,
  CheckCircle2,
} from "lucide-react";
import RideMap from "./Map";
import RideCharts from "./RideCharts";
import StatsDashboard from "./StatsDashboard";
import SettingsPage from "./SettingsPage";
import { useGpxDrop, type GpxImportFile } from "./useGpxDrop";
import type { StatsPeriod } from "./rideAnalytics";
import type { RoadMode } from "./useRoadOverlay";
import WindowControls from "./WindowControls";
import type { Ride, RidePreviewPoint } from "./types";
import { parseGpx } from "./gpx";
import { stats, number, dateLabel } from "./stats";
import {
  desktop,
  loadRides,
  saveRide,
  renameRide,
  deleteRide,
} from "./storage";
type Page = "map" | "history" | "stats" | "settings";
export default function App() {
  const [page, setPage] = useState<Page>("map"),
    [roadMode, setRoadMode] = useState<RoadMode>("heat"),
    [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("month"),
    [rides, setRides] = useState<Ride[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [hidden, setHidden] = useState<Set<string>>(new Set()),
    [fitKey, setFitKey] = useState(0),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<string[]>([]),
    [edit, setEdit] = useState(false),
    [name, setName] = useState(""),
    [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dark, setDark] = useState(
    () => localStorage.getItem("rideweave-theme") !== "light",
  );
  const [previewPoint, setPreviewPoint] = useState<RidePreviewPoint | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const recentScrollTop = useRef(0);
  const themeInitialized = useRef(false);
  const recentListRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.scrollTop = recentScrollTop.current;
    return () => {
      recentScrollTop.current = node.scrollTop;
    };
  }, []);
  useEffect(() => {
    loadRides()
      .then(setRides)
      .then(() => setReady(true))
      .catch((e) =>
        setError(`数据库加载失败：${String(e)}。请重启应用后重试。`),
      );
  }, []);
  useEffect(() => {
    const element = document.documentElement;
    if (themeInitialized.current) element.classList.add("theme-changing");
    themeInitialized.current = true;
    element.dataset.theme = dark ? "dark" : "light";
    const timeout = window.setTimeout(
      () => element.classList.remove("theme-changing"),
      320,
    );
    localStorage.setItem("rideweave-theme", dark ? "dark" : "light");
    if (desktop) {
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim();
      void getCurrentWebviewWindow()
        .setBackgroundColor(background || (dark ? "#080b0c" : "#f2f3f5"))
        .catch(console.error);
    }
    return () => {
      window.clearTimeout(timeout);
      element.classList.remove("theme-changing");
    };
  }, [dark]);
  const summary = stats(rides),
    current = rides.find((r) => r.id === selected);
  const visible = useMemo(
    () => rides.filter((r) => !hidden.has(r.id)),
    [rides, hidden],
  );
  const ordered = [...rides].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      b.importedAt.localeCompare(a.importedAt),
  );
  function select(id: string) {
    setSelected(id);
    setEdit(false);
    setConfirmDelete(null);
    setHidden((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  }
  const dropPaths = useGpxDrop({
    desktop,
    ready,
    busy,
    onImport: importFiles,
    onError: setError,
  });
  async function importFiles(files: GpxImportFile[]) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setReport([]);
    let added = 0,
      duplicates = 0;
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          if (!/\.gpx$/i.test(file.name)) throw new Error("仅支持 GPX 文件");
          if (file.size !== undefined && file.size > 50 * 1024 * 1024)
            throw new Error("文件超过 50 MB 限制");
          const raw = await file.text();
          const ride = await parseGpx(raw, file.name);
          if (await saveRide(ride, raw)) added++;
          else duplicates++;
        } catch (e) {
          failures.push(
            `${file.name}：${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setRides(await loadRides());
      setSelected(null);
      setFitKey((k) => k + 1);
      setReport([
        `导入完成：新增 ${added} 条，重复 ${duplicates} 条，失败 ${failures.length} 条。`,
        ...failures,
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setRides(await loadRides());
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function removeRide(ride: Ride) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await deleteRide(ride.id);
      setRides((prev) => prev.filter((r) => r.id !== ride.id));
      setSelected((prev) => (prev === ride.id ? null : prev));
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(ride.id);
        return next;
      });
      setConfirmDelete(null);
    } catch (e) {
      setError(`删除失败：${String(e)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const deletionPrompt = (ride: Ride) => (
    <div className="delete-confirm" role="alert">
      <p>删除“{ride.name}”及保存的原始轨迹？此操作不可撤销，源文件不受影响。</p>
      <button
        className="danger"
        disabled={busy}
        onClick={() => void removeRide(ride)}
      >
        {busy ? "正在删除…" : "确认删除"}
      </button>
      <button
        className="subtle"
        disabled={busy}
        onClick={() => setConfirmDelete(null)}
      >
        取消
      </button>
    </div>
  );
  const cards = [
    {
      label: "累计骑行距离",
      value: number(summary.distance),
      unit: "km",
      icon: Route,
    },
    {
      label: "累计骑行次数",
      value: String(summary.count),
      unit: "次",
      icon: Bike,
    },
    {
      label: "累计骑行时间",
      value: number(summary.duration === null ? null : summary.duration / 3600),
      unit: summary.duration === null ? "" : "h",
      icon: Clock3,
    },
    {
      label: "单次最长距离",
      value: number(summary.longest),
      unit: summary.longest === null ? "" : "km",
      icon: Mountain,
    },
  ];
  const list = (items: Ride[]) =>
    items.map((r) => (
      <div
        key={r.id}
        className={`ride-row ${selected === r.id ? "active" : ""}`}
      >
        <button
          className="ride-main"
          onClick={() => {
            select(r.id);
            setPage("map");
          }}
        >
          <span className="ride-icon">
            <Bike size={19} />
          </span>
          <span>
            <strong>{r.name}</strong>
            <small>{dateLabel(r.date)}</small>
          </span>
          <span className="ride-distance">
            {number(r.distance)}
            <small>km</small>
          </span>
        </button>
        <button
          className="icon-button"
          title={hidden.has(r.id) ? "显示路线" : "隐藏路线"}
          aria-label={`${hidden.has(r.id) ? "显示" : "隐藏"} ${r.name}`}
          onClick={() => {
            setHidden((prev) => {
              const s = new Set(prev);
              s.has(r.id) ? s.delete(r.id) : s.add(r.id);
              return s;
            });
            if (selected === r.id) setSelected(null);
          }}
        >
          {hidden.has(r.id) ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          className="icon-button danger"
          title="删除骑行记录"
          aria-label={`删除 ${r.name}`}
          disabled={busy}
          onClick={() => setConfirmDelete(r.id)}
        >
          <Trash2 size={16} />
        </button>
        {confirmDelete === r.id && deletionPrompt(r)}
      </div>
    ));
  return (
    <div className={`app ${page === "map" ? "map-page" : ""}`}>
      {dropPaths !== null && (
        <div className="gpx-drop-overlay" role="status" aria-live="polite">
          <div>
            <Download size={38} />
            <h2>
              {!ready
                ? "正在读取本地数据…"
                : busy
                  ? "正在处理文件…"
                  : dropPaths.some((path) => /\.gpx$/i.test(path))
                    ? "松开以导入 GPX"
                    : "请拖入 GPX 文件"}
            </h2>
            <p>
              {!ready || busy
                ? "请稍后再拖入文件"
                : "支持多个文件，每个不超过 50 MB"}
            </p>
          </div>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <span>
            <img
              src={new URL("../src-tauri/icon.svg", import.meta.url).href}
              alt=""
              width="47"
              height="47"
            />
          </span>
          <div>RideWeave</div>
        </div>

        <nav data-page={page} aria-label="主导航">
          {(
            [
              { id: "map", label: "骑行地图", icon: Map },
              { id: "history", label: "历史记录", icon: History },
              { id: "stats", label: "数据统计", icon: ChartNoAxesCombined },
              { id: "settings", label: "设置", icon: Settings },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "selected" : ""}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              <span className="nav-dot" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="live-dot" />
            {desktop ? "本地存储" : "浏览器界面预览"}
          </div>
        </div>
      </aside>
      <main>
        <header data-tauri-drag-region>
          <div className="titlebar-drag" data-tauri-drag-region />
          <div className="header-actions">
            <button
              className="icon-button theme-toggle"
              title={dark ? "切换浅色" : "切换深色"}
              aria-label={dark ? "切换浅色" : "切换深色"}
              onClick={() => setDark(!dark)}
            >
              <Sun className="theme-toggle-sun" size={19} aria-hidden="true" />
              <Moon
                className="theme-toggle-moon"
                size={19}
                aria-hidden="true"
              />
            </button>
            <WindowControls />
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <h1 key={page}>
                {
                  {
                    map: "骑行地图",
                    history: "历史记录",
                    stats: "数据统计",
                    settings: "设置",
                  }[page]
                }
              </h1>
            </div>
            <button
              className="primary"
              disabled={busy || !ready || !desktop}
              onClick={() => input.current?.click()}
            >
              <Download size={17} />
              {busy ? "正在处理…" : "导入 GPX"}
              <span>＋</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".gpx,application/gpx+xml"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void importFiles(files);
              }}
            />
          </div>
          {!desktop && (
            <div className="notice">
              当前为浏览器界面预览。请运行 npm run tauri dev 使用 SQLite 保存和
              GPX 导入。
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={16} />
              </button>
            </div>
          )}
          {report.length > 0 && (
            <div role="status" className="notice report">
              <div>
                <CheckCircle2 size={18} />
                <strong>{report[0]}</strong>
              </div>
              {report.length > 1 && (
                <details>
                  <summary>查看失败原因</summary>
                  {report.slice(1).map((r, i) => (
                    <p key={i}>{r}</p>
                  ))}
                </details>
              )}
              <button onClick={() => setReport([])} aria-label="关闭导入报告">
                <X size={16} />
              </button>
            </div>
          )}
          {page === "map" && (
            <>
              <div className="stats-grid">
                {cards.map((c) => (
                  <div className="stat-card" key={c.label}>
                    <div>
                      <span>{c.label}</span>
                      <c.icon size={18} />
                    </div>
                    <strong>
                      {c.value}
                      <small>{c.unit}</small>
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="map-layout" hidden={page !== "map"}>
            <section className="map-panel">
              <div className="panel-heading">
                <div>
                  <h2>我的骑行版图</h2>
                </div>
                <button
                  className="subtle"
                  onClick={() => {
                    setHidden(new Set());
                    setSelected(null);
                    setFitKey((k) => k + 1);
                  }}
                >
                  <LocateFixed size={16} />
                  全部轨迹
                </button>
              </div>
              <RideMap
                active={page === "map"}
                previewPoint={previewPoint}
                roadMode={roadMode}
                onRoadModeChange={setRoadMode}
                rides={visible}
                selected={selected}
                onSelect={select}
                onClearSelection={() => setSelected(null)}
                fitKey={fitKey}
                dark={dark}
              />
              {!rides.length && (
                <div className="empty-map">
                  <span className="empty-symbol">
                    <Route size={28} />
                  </span>
                  <h3>暂无骑行记录</h3>

                  <button
                    className="primary"
                    disabled={!desktop || busy || !ready}
                    onClick={() => input.current?.click()}
                  >
                    <Download size={16} />
                    导入第一条路线
                  </button>
                </div>
              )}
            </section>
            {page === "map" && (
              <aside className="ride-panel">
                {current ? (
                  <>
                    <div className="panel-heading">
                      <h2>骑行详情</h2>
                      <button
                        className="icon-button"
                        aria-label="关闭详情"
                        onClick={() => setSelected(null)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div key={`detail-${current.id}`} className="detail">
                      <span className="detail-badge">
                        <Bike size={15} /> 骑行记录
                      </span>
                      {edit ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const trimmed = name.trim();
                            if (trimmed)
                              void mutate(async () => {
                                await renameRide(current.id, trimmed);
                                setEdit(false);
                              });
                          }}
                        >
                          <input
                            autoFocus
                            aria-label="骑行名称"
                            value={name}
                            maxLength={120}
                            onChange={(e) => setName(e.target.value)}
                          />
                          <button
                            className="primary"
                            disabled={busy || !name.trim()}
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() => setEdit(false)}
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <h3>{current.name}</h3>
                      )}
                      <p>{dateLabel(current.date)}</p>
                      <div className="detail-metrics">
                        <div>
                          <small>骑行距离</small>
                          <strong>
                            {number(current.distance)} <em>km</em>
                          </strong>
                        </div>
                        <div>
                          <small>经过时间</small>
                          <strong>
                            {current.duration === null ? (
                              "暂无数据"
                            ) : (
                              <>
                                {current.duration >= 3600 && (
                                  <>
                                    {Math.floor(current.duration / 3600)}
                                    <em>h</em>{" "}
                                  </>
                                )}
                                {Math.floor((current.duration % 3600) / 60)}
                                <em>min</em>
                              </>
                            )}
                          </strong>
                        </div>
                        <div>
                          <small>平均速度</small>
                          <strong>
                            {number(
                              current.duration
                                ? current.distance / (current.duration / 3600)
                                : null,
                            )}{" "}
                            <em>{current.duration ? "km/h" : ""}</em>
                          </strong>
                        </div>
                        <div>
                          <small>轨迹点</small>
                          <strong>{current.segments.flat().length}</strong>
                        </div>
                      </div>
                      <RideCharts
                        key={current.id}
                        ride={current}
                        onPreview={setPreviewPoint}
                      />
                      <p className="filename">原始文件：{current.filename}</p>
                      <div className="detail-actions">
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => {
                            setName(current.name);
                            setEdit(true);
                          }}
                        >
                          <Pencil size={15} />
                          修改名称
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => setConfirmDelete(current.id)}
                        >
                          <Trash2 size={15} />
                          删除
                        </button>
                      </div>
                      {confirmDelete === current.id && deletionPrompt(current)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="panel-heading">
                      <h2>
                        最近骑行 <span className="count">{rides.length}</span>
                      </h2>
                      <button
                        className="icon-button"
                        title="全部历史记录"
                        onClick={() => setPage("history")}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                    <div key="recent" ref={recentListRef} className="ride-list">
                      {rides.length ? (
                        list(ordered.slice(0, 20))
                      ) : (
                        <div className="empty-list">
                          <Bike size={32} />
                          <h3>暂无骑行记录</h3>
                        </div>
                      )}
                    </div>
                    <div className="month-card">
                      <span>本月骑行</span>
                      <strong>
                        {number(summary.month)} <small>km</small>
                      </strong>
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>
          {page === "history" && (
            <section className="surface">
              <div className="panel-heading">
                <h2>全部骑行 · {rides.length}</h2>
              </div>
              {rides.length ? (
                list(ordered)
              ) : (
                <div className="empty-list">
                  <History size={34} />
                  <h3>还没有骑行记录</h3>
                  <p>点击“导入 GPX”添加记录。</p>
                </div>
              )}
            </section>
          )}
          {page === "stats" && (
            <StatsDashboard
              rides={rides}
              period={statsPeriod}
              onPeriodChange={setStatsPeriod}
              onSelect={(id) => {
                select(id);
                setPage("map");
              }}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              dark={dark}
              onThemeChange={setDark}
              recordCount={ready ? rides.length : null}
              desktop={desktop}
            />
          )}
        </div>
      </main>
    </div>
  );
}
