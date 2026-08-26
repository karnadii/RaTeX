#include "RaTeXViewMeasuringShadowNode.h"

#include <fbjni/fbjni.h>
#include <react/renderer/core/LayoutContext.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>

namespace facebook::react {

namespace {

// Natural [widthDp, totalHeightDp, depthDp] from the Kotlin engine
// (io.ratex.RaTeXMetrics — parse-cache backed, so a formula that has been
// measured never re-parses). Runs on the Fabric layout thread, the same thread
// measureContent already calls into Java from, so the app classloader is
// available to findClassStatic. Returns nullopt on parse failure.
std::optional<std::array<float, 3>> texMetrics(
    const RaTeXViewProps& props,
    Float pointScaleFactor) {
  static const auto metricsClass =
      facebook::jni::findClassStatic("io/ratex/RaTeXMetrics");
  static const auto metricsMethod =
      metricsClass
          ->getStaticMethod<jfloatArray(jstring, jfloat, jboolean, jfloat, jint)>(
              "metrics");

  auto latex = facebook::jni::make_jstring(props.latex);
  jint colorArgb = props.color ? static_cast<jint>(*props.color)
                               : static_cast<jint>(0xFF000000);
  auto result = metricsMethod(
      metricsClass,
      latex.get(),
      static_cast<jfloat>(props.fontSize),
      static_cast<jboolean>(props.displayMode),
      static_cast<jfloat>(pointScaleFactor),
      colorArgb);
  if (!result) {
    return std::nullopt;
  }
  std::array<float, 3> metrics{};
  result->getRegion(0, 3, metrics.data());
  return metrics;
}

} // namespace

void RaTeXViewMeasuringShadowNode::setMeasurementManager(
    const std::shared_ptr<RaTeXViewMeasurementManager>& measurementsManager) {
  ensureUnsealed();
  measurementsManager_ = measurementsManager;
}

Size RaTeXViewMeasuringShadowNode::measureContent(
    const LayoutContext& layoutContext,
    const LayoutConstraints& layoutConstraints) const {
  const auto& props = getConcreteProps();
  if (props.latex.empty() || props.fontSize <= 0) {
    return layoutConstraints.clamp({0, 0});
  }
  return layoutConstraints.clamp(
      measurementsManager_->measure(getSurfaceId(), layoutConstraints, props));
}

Float RaTeXViewMeasuringShadowNode::baseline(
    const LayoutContext& layoutContext,
    Size size) const {
  const auto& props = getConcreteProps();
  // Yoga's default for a node without a real baseline is its bottom edge.
  const Float fallback = size.height;
  if (props.latex.empty() || props.fontSize <= 0) {
    return fallback;
  }
  const auto metrics = texMetrics(props, layoutContext.pointScaleFactor);
  if (!metrics) {
    return fallback;
  }
  const auto naturalWidth = static_cast<Float>((*metrics)[0]);
  const auto naturalHeight = static_cast<Float>((*metrics)[1]);
  const auto depth = static_cast<Float>((*metrics)[2]);
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return fallback;
  }
  // Mirror RaTeXView.onDraw: scale down (never up) to fit the assigned frame,
  // center the scaled ink, and put the baseline `depth` above the ink bottom.
  const Float scale = std::min(
      Float(1),
      std::min(size.width / naturalWidth, size.height / naturalHeight));
  const Float dy = std::max(Float(0), (size.height - naturalHeight * scale) / 2);
  // Exact drawn ink baseline, snapped to the PIXEL grid (dp flooring made the
  // raise vary 0..1dp per formula), +1px uniform optical raise (a larger
  // reported baseline moves the child up). Same rule as iOS and as
  // RaTeXView.computeInlineShiftPx inside <Text>.
  const Float pixelScale =
      layoutContext.pointScaleFactor > 0 ? layoutContext.pointScaleFactor : 1;
  const Float inkBaseline = dy + naturalHeight * scale - depth * scale;
  return std::round(inkBaseline * pixelScale) / pixelScale + 1 / pixelScale;
}

} // namespace facebook::react
