// @vitest-environment node
import { afterAll, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ride } from "../src/types";

const fixture = vi.hoisted(() => ({ connection: null as DatabaseSync | null }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
// Exercise the production SQL statements against a real SQLite file.
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: async () => ({
      select: async (sql: string) => fixture.connection!.prepare(sql).all(),
      execute: async (sql: string, values: (string | number | null)[]) => ({
        rowsAffected: Number(
          fixture
            .connection!.prepare(sql)
            .run(
              Object.fromEntries(
                values.map((value, index) => [`$${index + 1}`, value]),
              ),
            ).changes,
        ),
      }),
    }),
  },
}));
import { loadRides, saveRide, renameRide, deleteRide } from "../src/storage";
const directory = mkdtempSync(join(tmpdir(), "rideweave-test-"));
const filename = join(directory, "rides.db");
afterAll(() => {
  fixture.connection?.close();
  rmSync(directory, { recursive: true });
});
it("persists original GPX, deduplicates, renames, reopens and deletes", async () => {
  fixture.connection = new DatabaseSync(filename);
  const rust = readFileSync("src-tauri/src/main.rs", "utf8");
  const schema = rust.match(/sql: "([^"]+)"/)![1];
  fixture.connection.exec(schema);
  const ride: Ride = {
    id: "test-hash",
    name: "测试记录",
    date: null,
    distance: 1,
    duration: null,
    segments: [
      [
        { lat: 0, lon: 0, time: null, elevation: null },
        { lat: 0, lon: 0.01, time: null, elevation: null },
      ],
    ],
    filename: "test.gpx",
    importedAt: "2026-10-01T00:00:00Z",
  };
  expect(await saveRide(ride, "<gpx>original</gpx>")).toBe(true);
  expect(await saveRide(ride, "duplicate")).toBe(false);
  expect(
    fixture.connection.prepare("SELECT raw_gpx FROM rides").get()?.raw_gpx,
  ).toBe("<gpx>original</gpx>");
  await renameRide(ride.id, "骑行 ' ; DROP TABLE rides; --");
  fixture.connection.close();
  fixture.connection = new DatabaseSync(filename);
  const records = await loadRides();
  expect(records).toHaveLength(1);
  expect(records[0].name).toBe("骑行 ' ; DROP TABLE rides; --");
  expect(records[0].segments).toEqual(ride.segments);
  await deleteRide(ride.id);
  expect(await loadRides()).toEqual([]);
});
