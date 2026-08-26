import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** Natural (unscaled) formula metrics in dp at the given font size. */
export type NativeTexMetrics = {
  /** Ink width. */
  width: number;
  /** Total ink height (ascent + depth). */
  height: number;
  /** Descent below the alphabetic baseline; the baseline sits at height - depth from the top. */
  depth: number;
};

export interface Spec extends TurboModule {
  /**
   * Sync TeX metrics, backed by the parse cache the native measure/render
   * passes share — an on-screen formula never re-parses. Null when empty or
   * parse failed. Sync on purpose: callers need it inside useLayoutEffect.
   */
  getTexMetrics(
    latex: string,
    fontSize: number,
    displayMode: boolean,
    /** Processed ARGB view color — Android's cache is color-keyed; iOS ignores it. */
    color: number,
  ): NativeTexMetrics | null;
}

export default TurboModuleRegistry.get<Spec>('RaTeXModule');
