import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bike,
  CalendarDays,
  Clock3,
  Flame,
  Route,
  Trophy,
} from "lucide-react";
import type { Ride } from "./types";
import { dateLabel, number } from "./stats";
import {
  durationLabel,
  rideAnalytics,
  type StatsPeriod,
} from "./rideAnalytics";

const periods: { id: StatsPeriod; label: string }[] = [
  { id: "month", label: "近30天" },
  { id: "year", label: "今年" },
  { id: "all", label: "全部" },
];
function chartCeiling(max: number, counts: boolean) {
  if (counts) return Math.max(2, Math.ceil(max / 2) * 2);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, max)));
  return [1, 2, 5, 10].find((n) => n * magnitude >= max)! * magnitude;
}

export default function StatsDashboard({
  rides,
  period,
  onPeriodChange,
  onSelect,
}: {
  rides: Ride[];
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  onSelect: (id: string) => void;
}) {
  const [metric, setMetric] = useState<"distance" | "count">("distance");
  const [hovered, setHovered] = useState<number | null>(null);
  const data = useMemo(() => rideAnalytics(rides, period), [rides, period]);
  const periodLabel = periods.find(({ id }) => id === period)!.label;
  const ceiling = chartCeiling(
    Math.max(0, ...data.trend.map((bucket) => bucket[metric])),
    metric === "count",
  );
  const preview = hovered === null ? null : data.trend[hovered];
  const trendDistance = data.trend.reduce(
    (sum, bucket) => sum + bucket.distance,
    0,
  );
  const weekdayMax = Math.max(1, ...data.weekdays.map((day) => day.count));
  const frequentDays = data.weekdays.filter(
    (day) => day.count && day.count === weekdayMax,
  );
  const records = [
    {
      label: "最远一次",
      ride: data.longest,
      value: number(data.longest?.distance ?? null),
      unit: "km",
    },
    {
      label: "最长一次",
      ride: data.longestDuration,
      value: durationLabel(data.longestDuration?.duration ?? null),
      unit: "",
    },
    {
      label: "最快均速",
      ride: data.fastest,
      value: number(
        data.fastest
          ? (data.fastest.distance / data.fastest.duration!) * 3600
          : null,
      ),
      unit: "km/h",
    },
  ];
  return (
    <div className="analytics" aria-label="骑行数据看板">
      <div className="analytics-toolbar">
        <div
          className="analytics-switch"
          role="group"
          aria-label="统计时间范围"
        >
          {periods.map(({ id, label }) => (
            <button
              key={id}
              aria-pressed={period === id}
              onClick={() => {
                setHovered(null);
                onPeriodChange(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <section className="analytics-overview" aria-label="统计概览">
        <div className="analytics-mileage">
          <span>
            <Route size={16} /> {periodLabel}骑行里程
          </span>
          <strong>
            {number(data.distance)}
            <small>km</small>
          </strong>
          <p>
            {data.count
              ? `平均每次 ${number(data.averageDistance)} km`
              : "从下一次出发开始积累"}
          </p>
        </div>
        <dl className="analytics-totals">
          <div>
            <dt>
              <Bike size={16} />
              骑行次数
            </dt>
            <dd>
              {data.count}
              <small>次</small>
            </dd>
          </div>
          <div>
            <dt>
              <CalendarDays size={16} />
              活跃天数
            </dt>
            <dd>
              {data.activeDays ?? "—"}
              <small>{data.activeDays === null ? "" : "天"}</small>
            </dd>
          </div>
          <div>
            <dt>
              <Clock3 size={16} />
              累计时间
            </dt>
            <dd className="analytics-time">{durationLabel(data.duration)}</dd>
          </div>
        </dl>
      </section>
      {!data.count ? (
        <section className="analytics-empty">
          <Bike size={32} />
          <h2>
            {rides.length
              ? "这个时间范围内还没有骑行记录"
              : "还没有可统计的骑行"}
          </h2>
          <p>
            {rides.length
              ? "换个时间范围，看看已经积累的骑行。"
              : "导入 GPX 后，这里会呈现你的骑行趋势和纪录。"}
          </p>
          {period !== "all" && (
            <button className="subtle" onClick={() => onPeriodChange("all")}>
              查看全部记录
            </button>
          )}
          {data.missingDate > 0 && (
            <small>{data.missingDate} 条记录没有有效日期，仅计入“全部”。</small>
          )}
        </section>
      ) : (
        <>
          <div className="analytics-highlights">
            <div>
              <span>综合均速</span>
              <strong>
                {number(data.averageSpeed)}
                <small>{data.averageSpeed === null ? "" : "km/h"}</small>
              </strong>
              <p>基于 {data.timedCount} 次有效时间记录</p>
            </div>
            <div>
              <span>平均单次用时</span>
              <strong>{durationLabel(data.averageDuration)}</strong>
              <p>按经过时间计算，含停留</p>
            </div>
            <div>
              <span>
                <Flame size={14} />
                最长连续骑行
              </span>
              <strong>
                {data.longestStreak ?? "—"}
                <small>{data.longestStreak === null ? "" : "天"}</small>
              </strong>
              <p>同一天多次骑行计 1 天</p>
            </div>
          </div>
          <div className="analytics-grid">
            <section
              className="analytics-card analytics-trend"
              aria-label="骑行趋势"
            >
              <div className="analytics-card-heading">
                <div>
                  <h2>{metric === "distance" ? "里程趋势" : "次数趋势"}</h2>
                  <p>
                    {period === "month"
                      ? "每天的骑行积累"
                      : "按日历月份汇总，长时间跨度自动分组"}
                  </p>
                </div>
                <div
                  className="analytics-switch"
                  role="group"
                  aria-label="趋势指标"
                >
                  <button
                    aria-pressed={metric === "distance"}
                    onClick={() => setMetric("distance")}
                  >
                    里程
                  </button>
                  <button
                    aria-pressed={metric === "count"}
                    onClick={() => setMetric("count")}
                  >
                    次数
                  </button>
                </div>
              </div>
              {data.trend.length ? (
                <>
                  <div className="analytics-trend-summary" aria-live="polite">
                    <span>
                      {preview?.detail ??
                        (data.datedCount < data.count
                          ? "有日期记录"
                          : periodLabel)}
                    </span>
                    <strong>
                      {number(
                        preview?.[metric] ??
                          (metric === "distance"
                            ? trendDistance
                            : data.datedCount),
                        metric === "distance" ? 1 : 0,
                      )}{" "}
                      <small>{metric === "distance" ? "km" : "次"}</small>
                    </strong>
                  </div>
                  <div className="analytics-plot">
                    <div className="analytics-y-axis" aria-hidden="true">
                      {[ceiling, ceiling / 2, 0].map((tick) => (
                        <span key={tick}>
                          {number(
                            tick,
                            metric === "count" || ceiling >= 10 ? 0 : 1,
                          )}
                        </span>
                      ))}
                    </div>
                    <div
                      className="analytics-bars"
                      style={{
                        gridTemplateColumns: `repeat(${data.trend.length}, minmax(0, 1fr))`,
                      }}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {data.trend.map((bucket, i) => (
                        <button
                          key={bucket.key}
                          className={hovered === i ? "is-active" : ""}
                          aria-label={`${bucket.detail}：${number(bucket.distance)} km，${bucket.count} 次`}
                          onMouseEnter={() => setHovered(i)}
                          onFocus={() => setHovered(i)}
                          onBlur={() => setHovered(null)}
                        >
                          <span
                            style={{
                              height: `${(bucket[metric] / ceiling) * 100}%`,
                            }}
                          />
                        </button>
                      ))}
                    </div>
                    <div className="analytics-x-axis" aria-hidden="true">
                      {[
                        ...new Set([
                          0,
                          Math.floor((data.trend.length - 1) / 2),
                          data.trend.length - 1,
                        ]),
                      ].map((i) => (
                        <span key={i}>{data.trend[i].label}</span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="analytics-no-data">
                  记录中没有有效日期，暂时无法绘制趋势。
                </p>
              )}
            </section>
            <section className="analytics-card" aria-label="骑行星期分布">
              <div className="analytics-card-heading">
                <div>
                  <h2>一周的骑行节奏</h2>
                  <p>按每次骑行的出发日累计</p>
                </div>
                <CalendarDays size={19} />
              </div>
              {data.datedCount ? (
                <>
                  <div className="analytics-weekdays">
                    {data.weekdays.map((day) => (
                      <div key={day.label}>
                        <strong>{day.count}</strong>
                        <div className="analytics-week-track">
                          <span
                            style={{
                              height: `${(day.count / weekdayMax) * 100}%`,
                            }}
                          />
                        </div>
                        <span>{day.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="analytics-frequency">
                    最常出发：{frequentDays.map((day) => day.label).join("、")}
                  </p>
                </>
              ) : (
                <p className="analytics-no-data">
                  有日期的记录会在这里呈现骑行习惯。
                </p>
              )}
            </section>
            <section className="analytics-card" aria-label="单次骑行纪录">
              <div className="analytics-card-heading">
                <div>
                  <h2>单次纪录</h2>
                  <p>{periodLabel}范围内的个人表现，点击查看路线</p>
                </div>
                <Trophy size={19} />
              </div>
              <div className="analytics-records">
                {records.map(({ label, ride, value, unit }) => (
                  <button
                    key={label}
                    disabled={!ride}
                    onClick={() => ride && onSelect(ride.id)}
                    aria-label={
                      ride ? `查看${label}：${ride.name}` : `${label}暂无数据`
                    }
                  >
                    <div>
                      <span>{label}</span>
                      <strong>{ride?.name ?? "暂无有效记录"}</strong>
                      <small>
                        {ride ? dateLabel(ride.date) : "有完整时间后可计算"}
                      </small>
                    </div>
                    <div className="analytics-record-value">
                      <strong>
                        {ride ? value : "—"}
                        <small>{ride ? unit : ""}</small>
                      </strong>
                      <ArrowUpRight size={16} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="analytics-card" aria-label="单次距离分布">
              <div className="analytics-card-heading">
                <div>
                  <h2>每次骑多远</h2>
                  <p>按单次里程分组</p>
                </div>
                <Route size={19} />
              </div>
              <div className="analytics-distribution">
                {data.distribution.map((bin) => (
                  <div key={bin.label}>
                    <div>
                      <span>{bin.label}</span>
                      <strong>
                        {bin.count} 次
                        <small>
                          {number((bin.count / data.count) * 100, 0)}%
                        </small>
                      </strong>
                    </div>
                    <div className="analytics-distribution-track">
                      <span
                        style={{ width: `${(bin.count / data.count) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <details className="analytics-method">
            <summary>统计口径与数据覆盖</summary>
            <p>
              统计包含所选范围内的全部记录，不受地图中路线显隐影响。综合均速 =
              有完整时间记录的总里程 ÷
              总经过时间；经过时间含停留，不是移动时间。单次最快均速使用相同口径。
            </p>
            <p>
              {data.count} 次骑行中，{data.timedCount} 次有有效经过时间
              {data.missingTime
                ? `，${data.missingTime} 次未计入时间和速度统计`
                : ""}
              。活跃天数、连续天数和星期分布按系统本地日期计算；近30天含今天，今年截至今天。跨午夜骑行归入出发日。
            </p>
            {data.missingDate > 0 && (
              <p>
                {data.missingDate}{" "}
                条记录缺少有效日期，仅计入“全部”的总数、里程、时间与单次纪录，不计入趋势和骑行天数。
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
