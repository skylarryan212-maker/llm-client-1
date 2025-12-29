import type { ComponentType } from "react";

// Optional wrapper so local builds don't fail if the Vercel package isn't installed.
let Impl: ComponentType = () => null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires,global-require
  const mod = require("@vercel/speed-insights/next");
  if (mod?.SpeedInsights) {
    Impl = mod.SpeedInsights as ComponentType;
  }
} catch {
  // fall back to no-op
}

export function OptionalSpeedInsights() {
  return <Impl />;
}
