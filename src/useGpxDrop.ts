import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";

export type GpxImportFile = Pick<File, "name" | "text"> & { size?: number };

export function useGpxDrop(options: {
  desktop: boolean;
  ready: boolean;
  busy: boolean;
  onImport: (files: GpxImportFile[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [paths, setPaths] = useState<string[] | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const importing = useRef(false);

  useEffect(() => {
    if (!options.desktop) return;
    let disposed = false;
    const listener = getCurrentWebviewWindow().onDragDropEvent(
      ({ payload }) => {
        if (disposed) return;
        if (payload.type === "enter") setPaths(payload.paths);
        else if (payload.type === "leave") setPaths(null);
        else if (payload.type === "drop") {
          setPaths(null);
          if (!payload.paths.length) return;
          const current = latest.current;
          if (!current.ready) {
            current.onError("本地数据尚未就绪，请稍后再拖入文件。");
            return;
          }
          if (current.busy || importing.current) {
            current.onError("正在处理文件，请完成后再次拖入。");
            return;
          }
          const files = [...new Set(payload.paths)].map((path) => ({
            name: path.split(/[\\/]/).at(-1) || path,
            text: () => invoke<string>("read_dropped_gpx", { path }),
          }));
          importing.current = true;
          void current
            .onImport(files)
            .catch(() => {
              if (!disposed)
                latest.current.onError(
                  "导入未完成，请重新拖入文件或使用导入按钮。",
                );
            })
            .finally(() => {
              importing.current = false;
            });
        }
      },
    );
    void listener.catch(() => {
      if (!disposed)
        latest.current.onError("拖入导入暂不可用，请使用“导入 GPX”按钮。");
    });
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
    // Register once; current callbacks and import state are read through latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return paths;
}
