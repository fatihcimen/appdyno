// What a device looks like around its screen: a small table by model and the plain maths of laying it out.
// All of it drawn in code; no artwork. Lengths are in the device's own points, so a frame scales with its picture.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(int, MVCutout) { MVCutoutNone,
                                 MVCutoutIsland,
                                 MVCutoutNotch,
                                 MVCutoutHole,
                                 MVCutoutHomeButton };
typedef NS_ENUM(int, MVEdge) { MVEdgeLeft,
                               MVEdgeRight,
                               MVEdgeTop };

/// A button on a device's edge, in fractions of that edge's screen length. No name: drawn, and it does nothing here.
typedef struct {
  const char *_Nullable name;
  MVEdge edge;
  double at, length;
} MVFrameKey;

typedef struct {
  /// Device points across the short side of the screen: what Actual Size means.
  double points;
  double radius;
  double bezel;
  /// The metal band outside the bezel.
  double rim;
  /// Added above and below the screen, on a phone with a Home button.
  double chin;
  MVCutout cutout;
  uint32_t color;
  const MVFrameKey *keys;
  int keyCount;
} MVFrameSpec;

/// The frame of a model by its name, or a kind's own when the model is not in the table. `color` is `#rrggbb` or nil.
MVFrameSpec MVFrameSpecOf(NSString *_Nullable model, NSString *_Nullable platform, NSString *_Nullable color, CGSize picture);

/// A frame laid out around a screen of `screen` points, stood up by `turns`, all in the frame's own flipped coordinates.
typedef struct {
  CGSize body;
  CGRect screen;
  /// The screen's corners, and the body's.
  double radius, outer;
  /// One device point in these units.
  double unit;
} MVFrameLayout;

MVFrameLayout MVLayOutFrame(MVFrameSpec spec, CGSize screen);

/// Where a key sits, in the coordinates of the layout, with `travel` of it standing proud of the body.
CGRect MVFrameKeyRect(MVFrameLayout layout, MVFrameKey key);

/// A cutout's rect in the coordinates of a portrait screen of this size; empty when it has none.
CGRect MVCutoutRect(MVFrameSpec spec, CGSize portraitScreen);

/// The largest scale at which `body` and its margins fit in `room`.
double MVFitScale(CGSize body, CGSize room);

/// The next step of zoom from this one, up or down, snapped to a round step.
double MVZoomStep(double zoom, BOOL bigger);

NS_ASSUME_NONNULL_END
