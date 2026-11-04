// What is behind everything in a window: a picture's own colours, in a few cells, for a layer to stretch into a soft mesh
// with no blur pass. A sparse sample on the window's thread, at a rate that costs nothing.
#import "Viewer.h"
#import "Window.h"

// the rate a backdrop follows its picture: it is mood, and costs nothing for being slow
static const double kBackdropSeconds = 2;

enum { kMoodColumns = 5, kMoodRows = 9, kMoodSamples = 6 };

/// A cell's colour, from a sparse sample: this runs on the window's thread.
static void cellOf(const uint8_t *base, size_t row, size_t x0, size_t y0, size_t w, size_t h, double out[3]) {
  double sum[3] = {0, 0, 0};
  for (int i = 0; i < kMoodSamples; i++) {
    for (int j = 0; j < kMoodSamples; j++) {
      const uint8_t *p = base + (y0 + h * i / kMoodSamples) * row + (x0 + w * j / kMoodSamples) * 4;
      sum[0] += p[2], sum[1] += p[1], sum[2] += p[0];
    }
  }
  for (int i = 0; i < 3; i++) out[i] = sum[i] / (kMoodSamples * kMoodSamples) / 255;
}

CGImageRef MVPictureMood(IOSurfaceRef surface, BOOL dark) {
  if (IOSurfaceGetBytesPerElement(surface) != 4 || IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL) != kIOReturnSuccess) return NULL;
  size_t width = IOSurfaceGetWidth(surface), height = IOSurfaceGetHeight(surface), row = IOSurfaceGetBytesPerRow(surface);
  const uint8_t *base = IOSurfaceGetBaseAddress(surface);
  uint8_t cells[kMoodRows * kMoodColumns * 4];
  for (int y = 0; y < kMoodRows; y++) {
    for (int x = 0; x < kMoodColumns; x++) {
      double c[3];
      cellOf(base, row, width * x / kMoodColumns, height * y / kMoodRows, width / kMoodColumns, height / kMoodRows, c);
      double luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      uint8_t *out = cells + (y * kMoodColumns + x) * 4;
      for (int i = 0; i < 3; i++) {
        // richer than the picture, and always behind it: dark stays dark and light stays light, whatever is on screen
        double rich = MAX(0, MIN(1, luma + (c[i] - luma) * 1.7));
        out[i] = (uint8_t)(255 * (dark ? 0.05 + rich * 0.5 : 0.56 + rich * 0.42));
      }
      out[3] = 255;
    }
  }
  IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(cells, kMoodColumns, kMoodRows, 8, kMoodColumns * 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return image;
}

@implementation MVBackdrop {
  CALayer *_layer;
  __weak NSWindow *_window;
  double _at;
}

- (instancetype)initInView:(NSView *)view window:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    _layer = [CALayer layer];
    _layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
    _layer.contentsGravity = kCAGravityResize;
    _layer.magnificationFilter = kCAFilterLinear;
    _layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    _layer.frame = view.bounds;
    [view.layer addSublayer:_layer];
  }
  return self;
}

- (void)followSurface:(IOSurfaceRef)surface {
  double now = MVNowMs();
  if (now - _at < kBackdropSeconds * 1000) return;
  _at = now;
  BOOL dark = [[_window.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
  CGImageRef mood = MVPictureMood(surface, dark);
  if (!mood) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _layer.contents = (__bridge id)mood;
  [CATransaction commit];
  CGImageRelease(mood);
}

@end
