import { useEffect, useRef, useState } from "react";
import { advancePlaybackPosition, type RideProfile } from "./rideProfile";

const initial = { position: 0, playing: false, active: false };
const MAX_PLAYBACK_SECONDS = 20;

export function useRidePlayback(profile: RideProfile, resetKey: unknown) {
  const [state, setState] = useState(initial);
  const resumeAfterScrub = useRef(false);
  const enabled = profile.samples.length > 1 && profile.extent > 0;
  // Short records keep their natural pace; longer records finish within 20 s.
  const unitsPerSecond = Math.max(1, profile.extent / MAX_PLAYBACK_SECONDS);
  useEffect(() => {
    resumeAfterScrub.current = false;
    setState(initial);
  }, [resetKey]);
  useEffect(() => {
    if (!state.playing || !enabled) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, (now - previous) / 1000) * unitsPerSecond;
      previous = now;
      setState((current) => {
        if (!current.playing) return current;
        const position = advancePlaybackPosition(
          profile,
          current.position,
          delta,
        );
        return { position, active: true, playing: position < profile.extent };
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [state.playing, enabled, profile, unitsPerSecond]);

  function toggle() {
    if (!enabled) return;
    resumeAfterScrub.current = false;
    setState((current) => ({
      position: current.position >= profile.extent ? 0 : current.position,
      playing: !current.playing,
      active: true,
    }));
  }
  function seek(value: number) {
    if (!enabled) return;
    const position = Number.isFinite(value)
      ? Math.max(0, Math.min(profile.extent, value))
      : 0;
    setState({ position, active: true, playing: false });
  }
  function beginScrub() {
    resumeAfterScrub.current = state.playing;
    setState((current) => ({ ...current, playing: false }));
  }
  function endScrub(resume = true) {
    const shouldResume = resume && resumeAfterScrub.current;
    resumeAfterScrub.current = false;
    if (shouldResume)
      setState((current) => ({
        ...current,
        playing: current.position < profile.extent,
      }));
  }
  return {
    ...state,
    enabled,
    toggle,
    seek,
    beginScrub,
    endScrub,
  };
}
