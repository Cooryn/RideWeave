# RideWeave 0.1

Windows 个人骑行轨迹管理应用。Tauri 2 + React + TypeScript + Leaflet/OpenStreetMap + SQLite。无账户、无云同步，真实数据为空时展示空状态，不附带虚构骑行记录。

## Windows 开发与运行

环境：Node.js 22.13+（推荐 24 LTS）、Rust stable MSVC、Visual Studio 2022 Build Tools（“使用 C++ 的桌面开发”及 Windows SDK）、Microsoft Edge WebView2 Runtime。SQLite 文件测试使用 Node 内置的 `node:sqlite`。

```powershell
npm ci
rustup toolchain install stable --profile minimal
npm run tauri dev
```

`npm run dev` 仅启动浏览器 UI 预览，不提供数据库或导入功能，避免误以为数据已保存。桌面入口使用 `npm run tauri dev`。

## 导入和使用

1. 从 Apple 健康导出数据并解压，找到 `workout-routes` 中的 GPX 文件（具体目录取决于导出版本）。本版不解析 ZIP 或健康 XML，也不自动识别运动类型，请选择骑行文件。
2. 点击右上角“导入 GPX”，按 Ctrl / Shift 多选；支持每个不超过 50 MB 的文件。
3. 导入结果显示新增、重复和失败数量，每个失败文件有单独原因；单个失败不影响其他文件。
4. 地图叠加所有轨迹，点击路线或记录查看详细数据。眼睛按钮切换路线显示。“全部轨迹”恢复所有路线并适配地图范围。
5. 在详情中修改名称或删除。删除需要确认，会删除数据库中的轨迹和原始 GPX，不删除源文件。

## 数据规则

- 距离：WGS84 经纬度的大圆距离（平均地球半径 6371.0088 km）累计，**不跨 trkseg 或 route 分段连接**。无道路匹配、去重道路里程或漂移修正。
- 时间：所有轨迹点具有有效且非倒序的带时区时间时，以首尾时间差计算经过时间，含停留。时间不完整、倒序或总时长为零则显示“暂无数据”。
- 平均速度：GPS 距离 ÷ 经过时间，不是移动速度。
- 日期：首个有效轨迹时间；本月统计使用系统本地时区。没有日期的记录不计入本月。
- 累计时间只合计有有效时间的记录，并提示缺失记录数。
- 去重：分段 GPS 坐标及标准化时间的 SHA-256，不受文件名、XML 排版或轨迹名称影响；同一路线不同日期保留。无时间且坐标完全相同的文件视为重复。
- 支持 GPX trk/trkseg 和 rte，保存各点海拔（如有）。纯 waypoints、少于两个连续有效点、无效坐标、损坏 XML 会报错，不用虚构值补齐。

## 数据保存和备份

SQLite 由 Tauri SQL 插件保存在 Windows 应用配置目录：

```text
%APPDATA%\com.rideweave.desktop\rideweave.db
```

每条记录保存解析后的点、统计字段以及完整原始 GPX。数据库通过版本化迁移创建，重启自动加载。关闭应用后备份整个该目录（如有 SQLite 附属文件，一并复制）。主题偏好保存在 WebView 本地存储。

底图联网访问 OpenStreetMap，地图服务会接收到瓦片范围请求；GPX 不上传。断网仍可导入和管理记录、显示轨迹线，但未缓存底图无法显示。本版不批量缓存或下载 OSM 瓦片。

## 验证和打包

```powershell
npm test
npm run build
npm run tauri build -- --features custom-protocol
```

NSIS 安装包输出到 `src-tauri/target/release/bundle/nsis/`，程序输出到 `src-tauri/target/release/rideweave.exe`。首次构建需要下载 Rust crates、Tauri 打包工具；安装时若缺少 WebView2，需要联网安装运行时。未配置商业代码签名，Windows 可能提示未知发布者。

图标源文件是 `src-tauri/icon.svg`，如需重新生成：`npm run tauri icon src-tauri/icon.svg`。

建议发布验收：导入多个真实 GPX → 检查分段/距离/时间 → 再次导入确认重复 → 隐藏/显示 → 重命名 → 关闭重启核对持久化 → 删除后核对统计 → 断网检查轨迹与底图提示 → 安装 NSIS 包复测。

### 本次验证结果（2026-10-27）

- 11 项自动化测试通过：GPX 与统计 8 项、真实 SQLite 文件读写及重新打开 1 项、批量导入与管理组件流程 1 项、真实 Leaflet 分段图层及点击/移除 1 项。
- TypeScript 检查、Vite 生产构建、Rust `cargo check` 通过。
- Windows x64 Release 程序和 NSIS 安装包构建成功。
- 通过命令行启动 Release 程序，运行 10 秒未提前退出；确认实际生成 SQLite 数据库，迁移版本 1 成功，初始骑行记录为 0。
- 按用户要求不使用 Computer Use。尚未进行安装向导操作、真实 GPX 的桌面端到端交互及人工视觉验收；组件测试不等同于原生文件选择器验收。

本机依赖下载使用过临时 npm/Rust 镜像，没有修改系统包源配置。常规环境使用上面的标准构建命令即可。

## 项目结构

```text
src/
  App.tsx          页面、导入流程、历史与详情交互
  Map.tsx          Leaflet 地图与路线图层
  gpx.ts           GPX 解析、距离、时间、内容指纹
  stats.ts         统计及格式化
  storage.ts       SQLite 参数化读写
  types.ts         轨迹类型
  style.css        自适应浅色/深色界面
src-tauri/
  src/main.rs      Tauri 入口及数据库迁移
  capabilities/   最小窗口权限
  tauri.conf.json  窗口、CSP、Windows 打包
tests/             GPX/统计、真实 SQLite 文件、组件流程与 Leaflet 图层测试
```

V0.1 不包含 GPS 道路匹配、实时定位、自动 Apple Health 同步、账户、云同步、社交或成就系统。

开发参考：[Tauri 2 SQL 插件与权限](https://v2.tauri.app/plugin/sql/)。项目包含 npm 和 Cargo 锁文件，以固定已验证的依赖版本。

## 开源许可

RideWeave 原创代码采用 [MIT License](LICENSE)，Copyright (c) 2026 Cooryn。允许使用、修改和分发（包括商业用途），分发时须保留版权和许可声明；软件按原样提供，不附带保证。

第三方依赖和地图数据保留各自许可，详见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。用户导入的 GPX、个人轨迹及数据库不因使用本软件而被授予 MIT 许可。

### 界面与窗口

默认使用运动风格深色外观：近黑背景、炭灰圆角卡片和彩色指标；设置中可切换浅色模式。字体优先使用系统无衬线字体，Windows 使用 Segoe UI Variable / 微软雅黑 UI，无需下载字体。

桌面窗口使用应用内标题栏：拖动顶部空白区域移动窗口，双击拖动区域最大化或还原，右上角按钮负责最小化、最大化或还原和关闭。内容区与记录列表使用细窄主题滚动条，支持滚轮与拖动。浏览器预览不显示桌面窗口控制按钮。更换系统窗口装饰需要重新启动桌面应用。

发布构建必须启用 `custom-protocol`，将前端资源内嵌到程序中。禁止直接将不带此特性的 `cargo build --release` 产物打包，否则程序会连接开发服务器 localhost:1420。项目已添加编译保护以阻止此类发布构建。


浅色外观与深色外观共享运动指标配色语义，使用冷灰背景、白色卡片和适合浅底阅读的深色指标。应用内品牌标识直接引用 `src-tauri/icon.svg`，桌面 ICO 与其他尺寸图标由同一源文件生成，保持荧光绿圆底与黑色骑行人物一致。

Windows 图标资源由 `build.rs` 显式跟踪 `icons/icon.ico` 的变更，以免增量构建复用旧图标。更换图标后应检查最终 EXE 提取出的图标，不能仅检查 SVG 或 PNG 源文件。



骑行地图页在支持的桌面窗口尺寸（最小 980×680）内使用自适应高度：地图填满标题和统计区下方的剩余空间，页面本身不滚动；长记录列表和骑行详情各自在面板内滚动。低于桌面最小宽度的浏览器预览保留纵向滚动以保证内容可访问。
