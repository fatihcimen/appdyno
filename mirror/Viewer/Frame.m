// The table of frames and the maths of laying one out. Corner radii are those each device type reports of
// itself; cutouts are measured against the picture of a simulator, which draws its own.
#import "Frame.h"

static const uint32_t kGraphite = 0x48494c, kCarbon = 0x2a2b2e;
static const double kIphoneScale = 3, kIpadScale = 2, kCompactScale = 2;
// Android's width in dp, on most phones
static const double kAndroidPoints = 411;
static const double kAndroidRadius = 26;
static const double kKeyStandsProud = 2.4;

static const MVFrameKey kIphoneKeys[] = {
    {NULL, MVEdgeLeft, 0.190, 0.038},
    {"volumeUp", MVEdgeLeft, 0.268, 0.074},
    {"volumeDown", MVEdgeLeft, 0.358, 0.074},
    {"lock", MVEdgeRight, 0.300, 0.118},
};
static const MVFrameKey kAndroidKeys[] = {
    {"volumeUp", MVEdgeRight, 0.215, 0.075},
    {"volumeDown", MVEdgeRight, 0.292, 0.075},
    {"lock", MVEdgeRight, 0.405, 0.055},
};
static const MVFrameKey kIpadKeys[] = {
    {"lock", MVEdgeTop, 0.80, 0.075},
    {"volumeUp", MVEdgeRight, 0.055, 0.058},
    {"volumeDown", MVEdgeRight, 0.125, 0.058},
};

/// First match wins, so a longer name comes before its start.
typedef struct {
  const char *prefix;
  double radius;
  MVCutout cutout;
} MVFrameRow;

static const MVFrameRow kRows[] = {
    {"iphone se", 0, MVCutoutHomeButton},
    {"iphone 18", 62, MVCutoutIsland},
    {"iphone 17e", 47.33, MVCutoutNotch},
    {"iphone 17", 62, MVCutoutIsland},
    {"iphone air", 62, MVCutoutIsland},
    {"iphone duo", 59, MVCutoutIsland},
    {"iphone 16e", 47.33, MVCutoutNotch},
    {"iphone 16 pro", 62, MVCutoutIsland},
    {"iphone 16", 55, MVCutoutIsland},
    {"iphone 15", 55, MVCutoutIsland},
    {"iphone 14 pro", 55, MVCutoutIsland},
    {"iphone 14 plus", 53.33, MVCutoutNotch},
    {"iphone 13 pro max", 53.33, MVCutoutNotch},
    {"iphone 13 mini", 44, MVCutoutNotch},
    {"iphone", 47.33, MVCutoutNotch},
    {"ipad pro", 30, MVCutoutNone},
    {"ipad", 18, MVCutoutNone},
};

static MVFrameSpec withKeys(MVFrameSpec spec, const MVFrameKey *keys, int count) {
  spec.keys = keys;
  spec.keyCount = count;
  return spec;
}

static uint32_t parseColor(NSString *_Nullable color, uint32_t otherwise) {
  if (color.length != 7 || ![color hasPrefix:@"#"]) return otherwise;
  unsigned value = 0;
  return [[NSScanner scannerWithString:[color substringFromIndex:1]] scanHexInt:&value] ? value : otherwise;
}

MVFrameSpec MVFrameSpecOf(NSString *_Nullable model, NSString *_Nullable platform, NSString *_Nullable color, CGSize picture) {
  NSString *name = model.lowercaseString ?: @"";
  double shortSide = MIN(picture.width, picture.height);
  for (size_t i = 0; i < sizeof kRows / sizeof kRows[0]; i++) {
    if (![name hasPrefix:@(kRows[i].prefix)]) continue;
    BOOL ipad = [name hasPrefix:@"ipad"];
    BOOL homeButton = kRows[i].cutout == MVCutoutHomeButton;
    MVFrameSpec spec = {
        .points = shortSide / (ipad ? kIpadScale : homeButton ? kCompactScale : kIphoneScale),
        .radius = kRows[i].radius,
        .bezel = ipad ? 18 : homeButton ? 14 : 7,
        .rim = ipad ? 3.5 : 3,
        .chin = homeButton ? 70 : 0,
        .cutout = kRows[i].cutout,
        .color = parseColor(color, kGraphite),
    };
    return ipad ? withKeys(spec, kIpadKeys, 3) : withKeys(spec, kIphoneKeys, 4);
  }
  MVFrameSpec android = {
      .points = kAndroidPoints,
      .radius = kAndroidRadius,
      .bezel = 6,
      .rim = 2.5,
      .cutout = [platform isEqual:@"android"] ? MVCutoutHole : MVCutoutNone,
      .color = parseColor(color, kCarbon),
  };
  return withKeys(android, kAndroidKeys, 3);
}

MVFrameLayout MVLayOutFrame(MVFrameSpec spec, CGSize screen, int turns) {
  double portraitWidth = MIN(screen.width, screen.height);
  double unit = spec.points > 0 ? portraitWidth / spec.points : 1;
  double side = (spec.bezel + spec.rim) * unit;
  double chin = spec.chin * unit;
  // the room a Home button takes runs along the long side, whichever way up that is
  BOOL sideways = screen.width > screen.height;
  double dx = side + (sideways ? chin : 0), dy = side + (sideways ? 0 : chin);
  return (MVFrameLayout){
      .body = CGSizeMake(screen.width + 2 * dx, screen.height + 2 * dy),
      .screen = CGRectMake(dx, dy, screen.width, screen.height),
      .radius = spec.radius * unit,
      .outer = (spec.radius > 0 ? spec.radius + spec.bezel + spec.rim : spec.chin > 0 ? 44 : spec.rim) * unit,
      .unit = unit,
  };
}

CGRect MVFrameKeyRect(MVFrameSpec spec, MVFrameLayout l, MVFrameKey key, int turns) {
  double proud = kKeyStandsProud * l.unit;
  double thick = proud + 1.5 * l.unit;
  BOOL sideways = l.body.width > l.body.height;
  CGSize body = sideways ? CGSizeMake(l.body.height, l.body.width) : l.body;
  double screenLong = sideways ? l.screen.size.width : l.screen.size.height;
  double screenShort = sideways ? l.screen.size.height : l.screen.size.width;
  double top = sideways ? l.screen.origin.x : l.screen.origin.y;
  double left = sideways ? l.screen.origin.y : l.screen.origin.x;
  // as it stands on a device held upright, its top edge up
  CGRect upright;
  switch (key.edge) {
    case MVEdgeLeft:
      upright = CGRectMake(-proud, top + key.at * screenLong, thick, key.length * screenLong);
      break;
    case MVEdgeRight:
      upright = CGRectMake(body.width - thick + proud, top + key.at * screenLong, thick, key.length * screenLong);
      break;
    default:
      upright = CGRectMake(left + key.at * screenShort, -proud, key.length * screenShort, thick);
      break;
  }
  if (!sideways) return upright;
  // a quarter turn, the device's top going to the left of the window
  return CGRectMake(upright.origin.y, body.width - CGRectGetMaxX(upright), upright.size.height, upright.size.width);
}

CGRect MVCutoutRect(MVFrameSpec spec, CGSize portrait) {
  double unit = spec.points > 0 ? portrait.width / spec.points : 1;
  double middle = portrait.width / 2;
  switch (spec.cutout) {
    case MVCutoutIsland:
      return CGRectMake(middle - 63 * unit, 14 * unit, 126 * unit, 37 * unit);
    case MVCutoutNotch:
      return CGRectMake(middle - 81 * unit, 0, 162 * unit, 33 * unit);
    case MVCutoutHole:
      return CGRectMake(middle - 7 * unit, 11 * unit, 14 * unit, 14 * unit);
    default:
      return CGRectZero;
  }
}

double MVFitScale(CGSize body, CGSize room) {
  if (body.width <= 0 || body.height <= 0) return 1;
  return MAX(0.01, MIN(room.width / body.width, room.height / body.height));
}

double MVZoomStep(double zoom, BOOL bigger) {
  static const double kStepsPerDoubling = 4;
  double steps = round(log2(zoom) * kStepsPerDoubling);
  return pow(2, (steps + (bigger ? 1 : -1)) / kStepsPerDoubling);
}
