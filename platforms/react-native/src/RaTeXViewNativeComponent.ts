import type {
  Double,
  Float,
  BubblingEventHandler,
  DirectEventHandler,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {ColorValue, HostComponent, ViewProps} from 'react-native';

type OnErrorEvent = {error: string};
type OnContentSizeChangeEvent = {width: Double; height: Double};

export interface NativeProps extends ViewProps {
  latex: string;
  fontSize?: Float;
  /** true (default) = display/block style; false = inline/text style. */
  displayMode?: boolean;
  color?: ColorValue;
  /**
   * Internal — derived from `style.alignSelf` by RaTeXView, do not set directly.
   * Vertical alignment of the formula against the surrounding text line when the
   * view is embedded inside <Text>. RaTeXView only sets it under a <Text>
   * ancestor (TextAncestorContext), so the same style in a flex row stays pure
   * Yoga.
   */
  inlineAlign?: WithDefault<'none' | 'baseline' | 'center' | 'start' | 'end', 'none'>;
  onError?: BubblingEventHandler<OnErrorEvent>;
  onContentSizeChange?: DirectEventHandler<OnContentSizeChangeEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'RaTeXView',
) as HostComponent<NativeProps>;
