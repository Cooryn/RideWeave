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
    [confirmDelete, setConfirmDelete] = useState(false);
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
    setConfirmDelete(false);
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
      </div>
    ));
  return (
    <div className="app">
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
        <div className="nav-caption">你的骑行空间</div>
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
          <div className="journey">
            <Route size={25} />
            <strong>把走过的路，连成风景。</strong>
            <p>
              记录每一次出发，
              <br />
              看见属于你的骑行网络。
            </p>
          </div>
          <div className="local-status">
            <span className="live-dot" />
            {desktop ? "本地存储 · 数据由你掌握" : "浏览器界面预览"}
            <small>RideWeave v0.1.0</small>
          </div>
        </div>
      </aside>
      <main>
        <header data-tauri-drag-region>
          <div className="breadcrumb" data-tauri-drag-region>
            我的空间 <span>/</span>{" "}
            {
              {
                map: "骑行地图",
                history: "历史记录",
                stats: "数据统计",
                settings: "设置",
              }[page]
            }
          </div>
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
              <div className="eyebrow">YOUR RIDES, CONNECTED</div>
              <h1>
                {
                  {
                    map: "每一程，都算数。",
                    history: "回望每一次出发",
                    stats: "看见你的积累",
                    settings: "让骑行记录更自在",
                  }[page]
                }
              </h1>
              <p>
                {
                  {
                    map: "在地图上收藏足迹，慢慢织出你的骑行网络。",
                    history: "每一段路线，都是属于你的城市记忆。",
                    stats: "由真实轨迹计算，记录每一步进展。",
                    settings: "简单、私密，属于你自己的骑行空间。",
                  }[page]
                }
              </p>
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
                    <span className="stat-note">
                      {c.label === "累计骑行时间"
                        ? summary.missingTime
                          ? `${summary.missingTime} 条记录缺少完整时间`
                          : "按记录经过时间计算"
                        : "来自你的 GPX 轨迹"}
                    </span>
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
                    <span>足迹交汇的地方，就是你的生活半径</span>
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
                  fitKey={fitKey}
                />
                {!rides.length && (
                  <div className="empty-map">
                    <span className="empty-symbol">
                      <Route size={28} />
                    </span>
                    <h3>你的骑行网络，从这里开始</h3>
                    <p>
                      导入 Apple 健康导出的 GPX 文件，
                      <br />
                      让每一次骑行在地图上留下足迹。
                    </p>
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
                        平均速度 = GPS 距离 ÷
                        记录经过时间（含停留）。缺少完整或有序时间时不计算。
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
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 size={15} />
                          删除
                        </button>
                      </div>
                      {confirmDelete && (
                        <div className="delete-confirm" role="alert">
                          <p>
                            删除这条骑行记录及保存的原始轨迹？此操作不可撤销，源文件不受影响。
                          </p>
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              void mutate(async () => {
                                await deleteRide(current.id);
                                setSelected(null);
                                setConfirmDelete(false);
                              })
                            }
                          >
                            确认删除
                          </button>
                          <button
                            className="subtle"
                            onClick={() => setConfirmDelete(false)}
                          >
                            取消
                          </button>
                        </div>
                      )}
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
                          <h3>期待你的第一程</h3>
                          <p>导入的骑行记录会出现在这里</p>
                        </div>
                      )}
                    </div>
                    <div className="month-card">
                      <span>本月骑行</span>
                      <strong>
                        {number(summary.month)} <small>km</small>
                      </strong>
                      <p>一点一滴，汇成更远的风景。</p>
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
                <span>按骑行时间倒序 · 无日期记录置后</span>
              </div>
              {rides.length ? (
                list(ordered)
              ) : (
                <div className="empty-list">
                  <History size={34} />
                  <h3>还没有骑行记录</h3>
                  <p>使用右上角“导入 GPX”添加一个或多个文件。</p>
                </div>
              )}
            </section>
          )}
          {page === "stats" && (
            <div className="stats-extra">
              <section className="surface">
                <div className="panel-heading">
                  <h2>这个月，你骑了多远？</h2>
                </div>
                <div className="big-month">
                  {number(summary.month)} <small>km</small>
                  <p>
                    {new Date().toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                    })}{" "}
                    · 按本地时区统计
                  </p>
                </div>
              </section>
              <section className="surface explanation">
                <h2>数据如何计算</h2>
                <p>距离使用相邻 GPS 点的大圆距离累加，不跨轨迹分段连接。</p>
                <p>
                  经过时间为首尾时间之差，包含停留；所有点的时间须完整且不倒序。
                </p>
                <p>
                  累计时间仅汇总可计算的记录；目前 {summary.missingTime}{" "}
                  条记录缺少有效时间。无日期的记录不计入本月。
                </p>
                <p>GPS 漂移可能影响距离。V0.1 不进行道路匹配或重复道路去重。</p>
              </section>
            </div>
          )}
          {page === "settings" && (
            <section className="surface settings">
              <h2>外观</h2>
              <div className="setting-row">
                <div>
                  <strong>深色模式</strong>
                  <p>默认采用运动风格深色主题，也可切换浅色外观。</p>
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
                  <p>
                    骑行数据和原始 GPX 保存在应用配置目录的 rideweave.db
                    中。备份前请关闭应用。
                  </p>
                  <code>%APPDATA%\com.rideweave.desktop\rideweave.db</code>
                </div>
              </div>
              <h2>地图与隐私</h2>
              <p>
                地图底图需要联网访问
                OpenStreetMap；请求包含当前地图瓦片范围。GPX
                文件不会上传到服务器。
              </p>
              <p>
                断网时仍可导入、管理记录并查看轨迹线，未加载的底图不可用。V0.1
                不提供离线地图下载。
              </p>
              <h2>关于 RideWeave</h2>
              <p>RideWeave 0.1.0 · 让每一次出发，都有迹可循。</p>
            </section>
          )}
          <footer>
            <span>
              <span className="live-dot" />{" "}
              {desktop ? "记录保存在本机" : "预览模式"} · 不需要账户
            </span>
            <span>RideWeave</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
