import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bike,
  Map,
  History,
  ChartNoAxesCombined,
  Settings,
  Upload,
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
  Database,
  CheckCircle2,
} from "lucide-react";
import RideMap from "./Map";
import WindowControls from "./WindowControls";
import type { Ride } from "./types";
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
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  useEffect(() => {
    loadRides()
      .then(setRides)
      .then(() => setReady(true))
      .catch((e) =>
        setError(`数据库加载失败：${String(e)}。请重启应用后重试。`),
      );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("rideweave-theme", dark ? "dark" : "light");
    if (desktop) {
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim();
      void getCurrentWebviewWindow()
        .setBackgroundColor(background || (dark ? "#080b0c" : "#f2f3f5"))
        .catch(console.error);
    }
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
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  }
  async function importFiles(files: File[]) {
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
          if (file.size > 50 * 1024 * 1024)
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

        <nav>
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
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {page === n.id && <span className="nav-dot" />}
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
              className="icon-button"
              title={dark ? "切换浅色" : "切换深色"}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <WindowControls />
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <h1>
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
              <Upload size={17} />
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
          {(page === "map" || page === "stats") && (
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
          {page === "map" && (
            <div className="map-layout">
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
                      <Upload size={16} />
                      导入第一条路线
                    </button>
                  </div>
                )}
              </section>
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
                    <div className="detail">
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
                            {number(
                              current.duration === null
                                ? null
                                : current.duration / 3600,
                            )}{" "}
                            <em>{current.duration !== null ? "h" : ""}</em>
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
                      <p className="calculation">
                        经过时间含停留，缺少完整时间时不计算速度。
                      </p>
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
                    <div className="ride-list">
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
            </div>
          )}
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
            <div className="stats-extra">
              <section className="surface">
                <div className="panel-heading">
                  <h2>本月骑行</h2>
                </div>
                <div className="big-month">
                  {number(summary.month)} <small>km</small>
                  <p>
                    {new Date().toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                    })}{" "}
                  </p>
                </div>
              </section>
              {summary.missingTime > 0 && (
                <div className="notice">
                  {summary.missingTime} 条记录缺少有效时间，未计入累计时间。
                </div>
              )}
            </div>
          )}
          {page === "settings" && (
            <section className="surface settings">
              <h2>外观</h2>
              <div className="setting-row">
                <div>
                  <strong>深色模式</strong>
                </div>
                <button className="subtle" onClick={() => setDark(!dark)}>
                  {dark ? <Moon size={18} /> : <Sun size={18} />}{" "}
                  {dark ? "深色" : "浅色"}
                </button>
              </div>
              <h2>本地数据</h2>
              <div className="setting-row">
                <Database size={24} />
                <div>
                  <strong>SQLite · 仅保存在这台电脑</strong>
                  <p>备份前请关闭应用。</p>
                  <code>%APPDATA%\com.rideweave.desktop\rideweave.db</code>
                </div>
              </div>
              <h2>地图与隐私</h2>
              <p>
                地图底图需要联网访问 OpenFreeMap（基于 OpenStreetMap
                数据）；请求包含当前地图范围和样式资源。GPX
                文件不会上传到服务器。
              </p>
              <p>
                骑行热区会按轨迹范围加载道路瓦片，在本机沿相连道路匹配，颜色仅沿道路显示重合记录数。
                同次骑行往返只计一次，不向道路外扩散。地图服务会收到道路瓦片范围请求，GPX
                与时间不上传。 匹配为估算，不会修改骑行距离或原始 GPX。
              </p>

              <h2>关于 RideWeave</h2>
              <p>RideWeave 0.2.0</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
