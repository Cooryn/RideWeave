import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

const [adb, serial, option] = process.argv.slice(2);
if (!adb || !serial?.startsWith("emulator-")) {
  throw new Error("Usage: node tests/android-smoke.mjs <adb path> <emulator-serial>");
}

const pkg = "com.rideweave.android";
const db = "sqlite:rideweave.db";
const run = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" }).trim();

async function shareFixture(raw, onShare) {
  const downloads = "content://media/external/downloads";
  const filename = `RideWeave-QA-${Date.now()}.gpx`;
  run("shell", "content", "insert", "--uri", downloads,
    "--bind", `_display_name:s:${filename}`, "--bind", "mime_type:s:application/gpx+xml");
  const rows = run("shell", "content", "query", "--uri", downloads, "--projection", "_id:_display_name");
  const id = rows.split(/\r?\n/).find((row) => row.endsWith(`_display_name=${filename}`))?.match(/_id=(\d+)/)?.[1];
  assert.ok(id, "Could not create the native share fixture");
  const uri = `${downloads}/${id}`;
  try {
    execFileSync(adb, ["-s", serial, "shell", "-T", "content", "write", "--uri", uri],
      { input: raw, encoding: "utf8" });
    run("shell", "am", "start", "-W", "-n", `${pkg}/.MainActivity`,
      "-a", "android.intent.action.SEND", "-t", "application/gpx+xml",
      "-d", uri, "--eu", "android.intent.extra.STREAM", uri, "--grant-read-uri-permission");
    await onShare();
  } finally {
    run("shell", "content", "delete", "--uri", uri);
  }
}

async function until(check, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await pause(250);
  } while (Date.now() < deadline);
  throw new Error(label, { cause: lastError });
}

async function inspect() {
  run("shell", "am", "start", "-W", "-n", `${pkg}/.MainActivity`);
  const pid = await until(() => run("shell", "pidof", pkg), "App process is missing");
  const port = run("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`);
  let socket;
  try {
    const target = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return false;
      return (await response.json()).find(({ type }) => type === "page");
    }, "App WebView debugging endpoint is missing");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
  } catch (error) {
    run("forward", "--remove", `tcp:${port}`);
    throw error;
  }

  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  });
  const command = async (method, params = {}) => {
    const requestId = ++id;
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("WebView did not return a test result"));
      }, 8000);
      pending.set(requestId, (message) => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve(message);
      });
      socket.send(JSON.stringify({
        id: requestId, method, params,
      }));
    });
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };
  const close = () => {
    socket.close();
    try {
      run("forward", "--remove", `tcp:${port}`);
    } catch {
      // A disconnected emulator drops its port forwarding automatically.
    }
  };
  return { evaluate, command, close };
}

const time = new Date(Date.now() - 3600000);
const name = `RideWeave 验收 ${time.getTime()}`;
const raw = `<gpx><trk><name>${name}</name><trkseg>
  <trkpt lat="30" lon="120"><time>${time.toISOString()}</time><ele>50</ele></trkpt>
  <trkpt lat="30.01" lon="120.01"><time>${new Date(time.getTime() + 1800000).toISOString()}</time><ele>60</ele></trkpt>
</trkseg></trk></gpx>`;
let web = await inspect();
try {
  const ready = () => web.evaluate(`Boolean(document.querySelector('.android-app .page-heading .primary:enabled'))`);
  const select = (query, values) => web.evaluate(
    `window.__TAURI_INTERNALS__.invoke('plugin:sql|select', ${JSON.stringify({ db, query, values })})`,
  );
  await until(ready, "Android SQLite did not become ready");
  assert.equal(await web.evaluate("window.isSecureContext && !!crypto.subtle"), true);
  await web.evaluate(`(() => {
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    for (const filename of ['ride.gpx', 'copy.GPX']) files.items.add(new File([${JSON.stringify(raw)}], filename));
    files.items.add(new File(['invalid'], 'broken.gpx'));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(() => web.evaluate(
    `(document.querySelector('.report') || document.body).textContent.includes('新增 1 条，重复 1 条，失败 1 条')`,
  ), "Mixed GPX import did not complete");

  const [ride] = await select("SELECT * FROM rides WHERE name=?", [name]);
  assert.equal(ride.raw_gpx, raw);
  assert.equal(ride.duration, 1800);
  assert.ok(ride.distance > 1.45 && ride.distance < 1.5);
  assert.equal(JSON.parse(ride.segments)[0][1].elevation, 60);
  await web.evaluate(`document.querySelector('nav button:nth-child(2)').click()`);
  await until(() => web.evaluate(
    `Array.from(document.querySelectorAll('.ride-main')).some(button => button.textContent.includes(${JSON.stringify(name)}))`,
  ), "Ride did not appear in history");
  await web.evaluate(
    `Array.from(document.querySelectorAll('.ride-main')).find(button => button.textContent.includes(${JSON.stringify(name)})).click()`,
  );
  await until(() => web.evaluate(
    `(document.querySelector('.detail') || document.body).textContent.includes(${JSON.stringify(name)}) && !!document.querySelector('.ride-playback')`,
  ), "Ride detail and playback did not open");
  const hasWebGLMap = await web.evaluate(
    `(document.querySelector('.maplibregl-canvas') || {}).width > 0`,
  );
  assert.equal(hasWebGLMap, true, "MapLibre canvas is missing");
  if (option === "--native-share") {
    const rotationEnabled = run("shell", "settings", "get", "system", "accelerometer_rotation");
    const rotation = run("shell", "settings", "get", "system", "user_rotation");
    try {
      run("shell", "cmd", "window", "user-rotation", "lock", "1");
      await until(() => web.evaluate("innerWidth > innerHeight"), "Landscape layout did not open");
      assert.equal(await web.evaluate("Boolean(document.querySelector('.ride-panel .detail'))"), true);
    } finally {
      if (rotationEnabled === "1") run("shell", "cmd", "window", "user-rotation", "free");
      else run("shell", "cmd", "window", "user-rotation", "lock", rotation === "null" ? "0" : rotation);
    }

    await web.evaluate("document.querySelector('nav button:nth-child(3)').click()");
    await until(() => web.evaluate("Boolean(document.querySelector('.analytics'))"), "Statistics page did not open");
    await web.evaluate("window.dispatchEvent(new Event('rideweave-back'))");
    await until(() => web.evaluate("Boolean(document.querySelector('.map-page'))"), "Back did not return to the map");

    await web.command("Network.enable");
    await web.command("Network.setCacheDisabled", { cacheDisabled: true });
    await web.command("Network.setBlockedURLs", { urls: ["*://tiles.openfreemap.org/*"] });
    await web.command("Page.reload", { ignoreCache: true });
    await until(ready, "Local data did not load with the map provider blocked");
    await until(() => web.evaluate(
      `Boolean(document.querySelector('.maplibregl-canvas')) &&
       Array.from(document.querySelectorAll('.tile-warning')).some(el => el.textContent.includes('重试底图'))`,
    ), "The local map did not stay available with the map provider blocked");
    console.log("Android landscape, statistics, back handling and offline map fallback passed");
  }

  web.close();
  web = undefined;
  run("shell", "am", "force-stop", pkg);
  web = await inspect();
  await until(ready, "Android SQLite did not reopen after app restart");
  const [persisted] = await select("SELECT id, raw_gpx FROM rides WHERE name=?", [name]);
  assert.equal(persisted.id, ride.id);
  assert.equal(persisted.raw_gpx, raw);
  const deleteRide = (id) => web.evaluate(
    `window.__TAURI_INTERNALS__.invoke('plugin:sql|execute', ${JSON.stringify({
      db, query: "DELETE FROM rides WHERE id=?", values: [id],
    })})`,
  );
  await deleteRide(ride.id);
  if (option === "--native-share") {
    const sharedName = `${name} Share`;
    const sharedRaw = raw.replace(name, sharedName).replace('lat="30.01"', 'lat="30.02"');
    await shareFixture(sharedRaw, async () => {
      const [shared] = await until(async () => {
        const records = await select("SELECT id, raw_gpx FROM rides WHERE name=?", [sharedName]);
        return records.length && records;
      }, "Native Android share did not import");
      assert.equal(shared.raw_gpx, sharedRaw);
      await deleteRide(shared.id);
      console.log("Android ACTION_SEND file grant and import passed");
    });
  }
  console.log(`Android API ${run("shell", "getprop", "ro.build.version.sdk")}: GPX import, SQLite, map canvas, detail and restart passed`);
} finally {
  web?.close();
}
