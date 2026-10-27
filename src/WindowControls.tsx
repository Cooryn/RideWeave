import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { desktop } from "./storage";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    const window = getCurrentWindow();
    let disposed = false;
    const sync = () =>
      window
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {});
    void sync();
    const listener = window.onResized(sync);
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  if (!desktop) return null;
  async function run(action: "minimize" | "toggleMaximize" | "close") {
    try {
      setError("");
      await getCurrentWindow()[action]();
    } catch {
      setError("窗口操作失败，请重试");
    }
  }
  return (
    <div className="window-controls">
      {error && (
        <span role="alert" className="window-error">
          {error}
        </span>
      )}
      <button
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void run("minimize")}
      >
        <Minus size={16} />
      </button>
      <button
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => void run("toggleMaximize")}
      >
        {maximized ? <Copy size={14} /> : <Square size={14} />}
      </button>
      <button
        className="window-close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => void run("close")}
      >
        <X size={18} />
      </button>
    </div>
  );
}
