import Database from "@tauri-apps/plugin-sql";
import { isTauri } from "@tauri-apps/api/core";
import type { Ride } from "./types";
let connection: Promise<Database> | undefined;
const db = () => (connection ??= Database.load("sqlite:rideweave.db"));
export const desktop = isTauri();
export async function loadRides(): Promise<Ride[]> {
  if (!desktop) return [];
  const rows = await (
    await db()
  ).select<
    Array<{
      id: string;
      name: string;
      date: string | null;
      distance: number;
      duration: number | null;
      segments: string;
      filename: string;
      imported_at: string;
    }>
  >(
    "SELECT id,name,date,distance,duration,segments,filename,imported_at FROM rides ORDER BY date DESC, imported_at DESC",
  );
  return rows.map((r) => ({
    ...r,
    segments: JSON.parse(r.segments),
    importedAt: r.imported_at,
  }));
}
export async function saveRide(ride: Ride, raw: string) {
  if (!desktop) throw new Error("请在桌面应用中导入，浏览器仅提供界面预览");
  const result = await (
    await db()
  ).execute(
    "INSERT OR IGNORE INTO rides (id,name,date,distance,duration,segments,raw_gpx,filename,imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      ride.id,
      ride.name,
      ride.date,
      ride.distance,
      ride.duration,
      JSON.stringify(ride.segments),
      raw,
      ride.filename,
      ride.importedAt,
    ],
  );
  return result.rowsAffected > 0;
}

/** Read one original only when its detail charts need legacy speed fields. */
export async function loadOriginalGpx(id: string): Promise<string | null> {
  if (!desktop) return null;
  const rows = await (
    await db()
  ).select<Array<{ raw_gpx: string }>>(
    "SELECT raw_gpx FROM rides WHERE id=$1",
    [id],
  );
  return rows[0]?.raw_gpx ?? null;
}
export async function renameRide(id: string, name: string) {
  await (
    await db()
  ).execute("UPDATE rides SET name=$1 WHERE id=$2", [name, id]);
}
export async function deleteRide(id: string) {
  await (await db()).execute("DELETE FROM rides WHERE id=$1", [id]);
}
