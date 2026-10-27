export type Point = {
  lat: number;
  lon: number;
  elevation: number | null;
  time: string | null;
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
