import 'display_list.dart';

abstract class RaTeXBackend {
  DisplayList parseAndLayout(
    String latex, {
    bool displayMode = true,
    RaTeXColor color = const RaTeXColor(0, 0, 0, 1),
  });
}
