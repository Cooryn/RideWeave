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
import { version as androidVersion } from "../src-tauri/tauri.android.conf.json";
import { version as windowsVersion } from "../src-tauri/tauri.windows.conf.json";

export default function SettingsPage({
  dark,
  onThemeChange,
  recordCount,
  nativeApp,
  android,
  busy,
  confirmRestore,
  onExport,
  onConfirmRestore,
  onRestore,
}: {
  dark: boolean;
  onThemeChange: (dark: boolean) => void;
  recordCount: number | null;
  nativeApp: boolean;
  android: boolean;
  busy: boolean;
  confirmRestore: boolean;
  onExport: () => void;
  onConfirmRestore: (confirm: boolean) => void;
  onRestore: () => void;
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
                {nativeApp
                  ? "原始 GPX、轨迹点与骑行统计保存在本机。"
                  : "当前为界面预览，请在 RideWeave 应用中导入和保存骑行。"}
              </p>
            </div>
            <span className="preference-value">
              {nativeApp
                ? recordCount === null
                  ? "暂未读取"
                  : `${recordCount} 条记录`
                : "预览模式"}
            </span>
          </div>
          {nativeApp && (
            <div className="preference-row backup-row">
              <div className="preference-label">
                <h3>骑行备份</h3>
                <p>
                  {android
                    ? "可恢复 Windows 或 Android 导出的 RideWeave 备份。"
                    : "导出一个备份文件，可将完整的骑行记录迁移到 Android。"}
                </p>
              </div>
              <div className="backup-actions">
                <button className="subtle" disabled={busy} onClick={onExport}>
                  导出备份
                </button>
                {android && (
                  <button
                    className="subtle"
                    disabled={busy}
                    onClick={() => onConfirmRestore(true)}
                  >
                    恢复备份
                  </button>
                )}
              </div>
            </div>
          )}
          {android && confirmRestore && (
            <div className="preference-row backup-row" role="alert">
              <p>恢复会合并骑行记录，重复记录保留本机版本。</p>
              <div className="backup-actions">
                <button className="primary" disabled={busy} onClick={onRestore}>
                  选择备份文件
                </button>
                <button
                  className="subtle"
                  onClick={() => onConfirmRestore(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <details className="preference-details">
            <summary>
              <span>数据位置与备份</span>
              <ChevronDown size={17} />
            </summary>
            <div>
              {android ? (
                <p>
                  数据库位于 Android
                  应用私有目录。请通过上方的按钮导出到你选择的位置。导入的源 GPX
                  文件仍在原位置。
                </p>
              ) : (
                <>
                  <p>Windows 数据文件位置</p>
                  <code>%APPDATA%\com.rideweave.desktop\rideweave.db</code>
                  <p>
                    手动备份时先退出
                    RideWeave，再复制整个数据文件夹，并保留数据库附属文件。导入的源
                    GPX 文件仍在原位置。
                  </p>
                </>
              )}
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
            <span className="preference-value">
              v{android ? androidVersion : windowsVersion}
            </span>
          </div>
          <div className="preferences-footnote">
            <Bike size={14} />
            <span>
              {android
                ? "Android 版"
                : nativeApp
                  ? "Windows 桌面版"
                  : "浏览器界面预览"}
            </span>
            <span>本地保存 · 无需账户</span>
          </div>
        </div>
      </section>
    </div>
  );
}
