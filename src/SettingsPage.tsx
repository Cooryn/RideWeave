import {
  Bike,
  Check,
  ChevronDown,
  Database,
  Info,
  Map,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { version } from "../package.json";

export default function SettingsPage({
  dark,
  onThemeChange,
  recordCount,
  desktop,
}: {
  dark: boolean;
  onThemeChange: (dark: boolean) => void;
  recordCount: number | null;
  desktop: boolean;
}) {
  return (
    <div className="preferences" aria-label="应用设置">
      <section
        className="preferences-group"
        aria-labelledby="appearance-heading"
      >
        <h2 id="appearance-heading">
          <Palette size={18} />
          外观
        </h2>
        <div className="preferences-card">
          <div className="preference-row">
            <div className="preference-label">
              <h3>界面主题</h3>
              <p>切换后立即生效，自动记住你的选择。</p>
            </div>
            <div className="theme-options" role="group" aria-label="界面主题">
              {[
                { value: false, label: "浅色", Icon: Sun },
                { value: true, label: "深色", Icon: Moon },
              ].map(({ value, label, Icon }) => (
                <button
                  key={label}
                  aria-label={`使用${label}主题`}
                  aria-pressed={dark === value}
                  onClick={() => onThemeChange(value)}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  <Check size={15} className="theme-check" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="data-heading">
        <h2 id="data-heading">
          <Database size={18} />
          本地数据
        </h2>
        <div className="preferences-card">
          <div className="preference-row">
            <div className="preference-label">
              <h3>骑行记录</h3>
              <p>
                {desktop
                  ? "原始 GPX、轨迹点与骑行统计保存在这台电脑。"
                  : "当前为界面预览，请在桌面应用中导入和保存骑行。"}
              </p>
            </div>
            <span className="preference-value">
              {desktop
                ? recordCount === null
                  ? "暂未读取"
                  : `${recordCount} 条记录`
                : "预览模式"}
            </span>
          </div>
          <details className="preference-details">
            <summary>
              <span>数据位置与备份</span>
              <ChevronDown size={17} />
            </summary>
            <div>
              <p>Windows 数据文件位置</p>
              <code>%APPDATA%\com.rideweave.desktop\rideweave.db</code>
              <p>
                备份时先退出
                RideWeave，再复制整个数据文件夹；同目录下的数据库附属文件也需要一并保留。导入的源
                GPX 文件仍在原位置。
              </p>
            </div>
          </details>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">
          <ShieldCheck size={18} />
          地图与隐私
        </h2>
        <div className="preferences-card">
          <div className="preference-row">
            <div className="preference-label">
              <h3>
                <Map size={16} />
                地图服务
              </h3>
              <p>OpenFreeMap 提供底图与道路瓦片，基于 OpenStreetMap 数据。</p>
            </div>
            <span className="preference-badge">需要联网</span>
          </div>
          <div className="preference-row">
            <div className="preference-label">
              <h3>
                <ShieldCheck size={16} />
                轨迹隐私
              </h3>
              <p>地图请求包含对应区域范围，原始 GPX 和轨迹时间不会上传。</p>
            </div>
            <span className="preference-badge is-local">轨迹留在本机</span>
          </div>
          <details className="preference-details">
            <summary>
              <span>路线与热区说明</span>
              <ChevronDown size={17} />
            </summary>
            <div>
              <p>
                骑行路线保留原始 GPX
                的位置与形状，暂停缺口优先沿道路补连；道路不可用时直接连接两端。
              </p>
              <p>
                骑行热区在本机将双向道路归并居中，按经过次数累计；同一记录里的往返或多次经过会分别计数。匹配和补连仅影响地图展示，不修改原始
                GPX、里程或时间统计。
              </p>
            </div>
          </details>
        </div>
      </section>

      <section className="preferences-group" aria-labelledby="about-heading">
        <h2 id="about-heading">
          <Info size={18} />
          关于
        </h2>
        <div className="preferences-card">
          <div className="preference-row preferences-about">
            <div className="preferences-product">
              <img
                src={new URL("../src-tauri/icon.svg", import.meta.url).href}
                alt=""
                width="42"
                height="42"
              />
              <div>
                <h3>RideWeave</h3>
                <p>个人骑行地图与记录管理</p>
              </div>
            </div>
            <span className="preference-value">v{version}</span>
          </div>
          <div className="preferences-footnote">
            <Bike size={14} />
            <span>{desktop ? "Windows 桌面版" : "浏览器界面预览"}</span>
            <span>本地保存 · 无需账户</span>
          </div>
        </div>
      </section>
    </div>
  );
}
