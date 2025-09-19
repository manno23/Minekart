import { clamp } from "./math";

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;

export const lighten = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const lift = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return rgbToHex(clamp(lift(r), 0, 255), clamp(lift(g), 0, 255), clamp(lift(b), 0, 255));
};

export const darken = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const drop = (channel: number) => Math.round(channel * (1 - amount));
  return rgbToHex(clamp(drop(r), 0, 255), clamp(drop(g), 0, 255), clamp(drop(b), 0, 255));
};

export const mix = (base: string, overlay: string, amount: number): string => {
  const [br, bg, bb] = hexToRgb(base);
  const [or, og, ob] = hexToRgb(overlay);
  const blend = (bChannel: number, oChannel: number) => Math.round(bChannel + (oChannel - bChannel) * amount);
  return rgbToHex(
    clamp(blend(br, or), 0, 255),
    clamp(blend(bg, og), 0, 255),
    clamp(blend(bb, ob), 0, 255)
  );
};
