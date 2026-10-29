// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { parseGpx, gpxSegments } from "../src/gpx";
import { stats } from "../src/stats";
vi.stubGlobal("crypto", webcrypto);
const point = (lon: number, time?: string) =>
  `<trkpt lat="0" lon="${lon}"><ele>12.5</ele>${time ? `<time>${time}</time>` : ""}</trkpt>`;
const wrap = (points: string) =>
  `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>测试骑行</name><trkseg>${points}</trkseg></trk></gpx>`;
describe("GPX calculations", () => {
  it("calculates real distance, elapsed time and elevation", async () => {
    const r = await parseGpx(
      wrap(point(0, "2026-10-01T00:00:00Z") + point(1, "2026-10-01T01:00:00Z")),
      "ride.gpx",
    );
    expect(r.distance).toBeCloseTo(111.195, 2);
    expect(r.duration).toBe(3600);
    expect(r.segments[0][0].elevation).toBe(12.5);
  });
  it("never joins separate track segments", async () => {
    const r = await parseGpx(
      wrap(point(0) + point(1) + "</trkseg><trkseg>" + point(10) + point(11)),
      "ride.gpx",
    );
    expect(r.distance).toBeCloseTo(222.39, 2);
    expect(r.duration).toBeNull();
    expect(r.date).toBeNull();
  });
  it("reads recorded speed from point fields and nested extensions without changing ride identity", async () => {
    const points = ["0", "5.5", "-1", "NaN", "Infinity", ""]
      .map((speed, i) =>
        point(i / 1000).replace(
          "</trkpt>",
          `<extensions><x:TrackPointExtension xmlns:x="urn:test"><x:speed>${speed}</x:speed></x:TrackPointExtension></extensions></trkpt>`,
        ),
      )
      .join("");
    const raw = wrap(points);
    const r = await parseGpx(raw, "test.gpx");
    expect(r.segments[0].map((p) => p.speed)).toEqual([
      0,
      5.5,
      null,
      null,
      null,
      null,
    ]);
    expect(gpxSegments(raw)).toEqual(r.segments);
    expect(
      (
        await parseGpx(
          raw.replace("<x:speed>5.5</x:speed>", "<x:speed>9</x:speed>"),
          "test.gpx",
        )
      ).id,
    ).toBe(r.id);
    const direct = await parseGpx(
      wrap(
        point(0).replace("</trkpt>", "<speed>2</speed></trkpt>") + point(0.001),
      ),
      "direct.gpx",
    );
    expect(direct.segments[0].map((p) => p.speed)).toEqual([2, null]);
  });
  it("deduplicates XML formatting and metadata changes", async () => {
    const a = wrap(point(0) + point(1));
    expect((await parseGpx(a, "one.gpx")).id).toBe(
      (
        await parseGpx(
          a.replace("测试骑行", "不同名称").replace("<trk>", "<trk>\n"),
          "two.gpx",
        )
      ).id,
    );
  });
  it("distinguishes the same route on a different day", async () => {
    const a = wrap(
      point(0, "2026-10-01T00:00:00Z") + point(1, "2026-10-01T01:00:00Z"),
    );
    expect((await parseGpx(a, "a.gpx")).id).not.toBe(
      (await parseGpx(a.replaceAll("10-01", "10-02"), "b.gpx")).id,
    );
  });
  it("does not invent missing, reverse or zero elapsed time", async () => {
    for (const points of [
      point(0, "2026-10-01T00:00:00Z") + point(1),
      point(0, "2026-10-01T01:00:00Z") + point(1, "2026-10-01T00:00:00Z"),
      point(0, "2026-10-01T00:00:00Z") + point(1, "2026-10-01T00:00:00Z"),
    ])
      expect((await parseGpx(wrap(points), "r.gpx")).duration).toBeNull();
  });
  it("rejects malformed XML, no GPS and invalid coordinates", async () => {
    for (const raw of [
      "<gpx>",
      "<html/>",
      "<gpx/>",
      wrap(point(0)),
      wrap(point(181) + point(0)),
      wrap('<trkpt lat="" lon="0"/>' + point(1)),
    ])
      await expect(parseGpx(raw, "bad.gpx")).rejects.toThrow();
  });
  it("handles route points and namespace prefixes", async () => {
    const r = await parseGpx(
      '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:rte><g:rtept lat="0" lon="0"/><g:rtept lat="0" lon="1"/></g:rte></g:gpx>',
      "route.gpx",
    );
    expect(r.distance).toBeCloseTo(111.195, 2);
  });
  it("aggregates known durations and local calendar months", async () => {
    const a = await parseGpx(wrap(point(0) + point(1)), "a.gpx");
    const b = {
      ...a,
      id: "b",
      date: new Date(2026, 9, 5).toISOString(),
      duration: 3600,
    };
    const s = stats([a, b], new Date(2026, 9, 27));
    expect(s.count).toBe(2);
    expect(s.duration).toBe(3600);
    expect(s.missingTime).toBe(1);
    expect(s.month).toBe(b.distance);
    expect(stats([]).longest).toBeNull();
    expect(stats([a]).duration).toBeNull();
  });
});
