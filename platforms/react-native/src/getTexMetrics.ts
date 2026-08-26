import {processColor} from 'react-native';
import type {ColorValue} from 'react-native';
import NativeRaTeXModule from './NativeRaTeXModule';

/** Natural (unscaled) formula ink metrics in dp at the given font size. */
export interface RaTeXNaturalTexMetrics {
  /** Ink width. */
  width: number;
  /** Total ink height (ascent + depth). */
  height: number;
  /** Descent below the baseline; the baseline sits at `height - depth`. */
  depth: number;
}

/**
 * Sync natural TeX metrics for a formula — no view needed. Backed by the
 * parse cache the measure/render passes share. Null when empty, parse failed,
 * or the native module is unavailable.
 *
 * `color` should match the render color so Android's color-keyed cache entry
 * is shared with the on-screen view (iOS metrics are color-blind).
 */
export function getTexMetrics(
  latex: string,
  fontSize: number,
  displayMode: boolean,
  color?: ColorValue,
): RaTeXNaturalTexMetrics | null {
  const processed = processColor(color);
  return (
    NativeRaTeXModule?.getTexMetrics(
      latex,
      fontSize,
      displayMode,
      typeof processed === 'number' ? processed : 0xff000000,
    ) ?? null
  );
}
