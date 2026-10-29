export type Point = {
  lat: number;
  lon: number;
  elevation: number | null;
  time: string | null;
  /** Recorded metres per second; undefined in records imported by older versions. */
  speed?: number | null;
};
export type Ride = {
  id: string;
  name: string;
  date: string | null;
  distance: number;
  duration: number | null;
  segments: Point[][];
  filename: string;
  importedAt: string;
};

export type RidePreviewPoint = {
  rideId: string;
  lon: number;
  lat: number;
};
