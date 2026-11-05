// A picture's own colours, in a few cells, for a layer to stretch into a soft mesh with no blur pass. A sparse sample
// on the window's thread: a surface is 32-bit, and a decoded stream is 8-bit 4:2:0 with its colours in a plane of their own.
#import "Viewer.h"
#import "Window.h"

enum { kMoodColumns = 5, kMoodRows = 9, kMoodSamples = 6 };
// the rate a backdrop follows its picture: it is mood, and costs nothing for being slow
static const double kBackdropSeconds = 2;

typedef struct {
  const uint8_t *base;
  /// Its colours, where they are apart from its brightness.
  const uint8_t *chroma;
  size_t row, chromaRow, width, height;
  /// How many of the picture's columns and lines one pair of colours covers.
  size_t columnsApart, linesApart;
} MVPixels;

static double unit(double v) {
  return MAX(0, MIN(1, v));
}

static void pixelAt(const MVPixels *p, size_t x, size_t y, double out[3]) {
  if (!p->chroma) {
    const uint8_t *px = p->base + y * p->row + x * 4;
    out[0] = px[2] / 255.0, out[1] = px[1] / 255.0, out[2] = px[0] / 255.0;
    return;
  }
  const uint8_t *pair = p->chroma + y / p->linesApart * p->chromaRow + x / p->columnsApart * 2;
  // BT.709, as a video's range: a mood has no need of more, and a phone's stream is near enough to it
  double luma = (p->base[y * p->row] - 16) / 219.0, cb = (pair[0] - 128) / 224.0, cr = (pair[1] - 128) / 224.0;
  out[0] = unit(luma + 1.5748 * cr), out[1] = unit(luma - 0.1873 * cb - 0.4681 * cr), out[2] = unit(luma + 1.8556 * cb);
}

static void cellOf(const MVPixels *p, size_t x0, size_t y0, double out[3]) {
  size_t w = p->width / kMoodColumns, h = p->height / kMoodRows;
  double sum[3] = {0, 0, 0};
  for (int i = 0; i < kMoodSamples; i++) {
    for (int j = 0; j < kMoodSamples; j++) {
      double one[3];
      pixelAt(p, x0 + w * j / kMoodSamples, y0 + h * i / kMoodSamples, one);
      for (int k = 0; k < 3; k++) sum[k] += one[k];
    }
  }
  for (int i = 0; i < 3; i++) out[i] = sum[i] / (kMoodSamples * kMoodSamples);
}

static CGImageRef moodOf(const MVPixels *p, BOOL dark) {
  uint8_t cells[kMoodRows * kMoodColumns * 4];
  for (int y = 0; y < kMoodRows; y++) {
    for (int x = 0; x < kMoodColumns; x++) {
      double c[3];
      cellOf(p, p->width * x / kMoodColumns, p->height * y / kMoodRows, c);
      double luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      uint8_t *out = cells + (y * kMoodColumns + x) * 4;
      for (int i = 0; i < 3; i++) {
        // richer than the picture, and always behind it: dark stays dark and light stays light, whatever is on screen
        double rich = unit(luma + (c[i] - luma) * 1.7);
        out[i] = (uint8_t)(255 * (dark ? 0.05 + rich * 0.28 : 0.62 + rich * 0.36));
      }
      out[3] = 255;
    }
  }
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(cells, kMoodColumns, kMoodRows, 8, kMoodColumns * 4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return image;
}

CGImageRef MVPictureMood(IOSurfaceRef surface, BOOL dark) {
  if (IOSurfaceGetBytesPerElement(surface) != 4 || IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL) != kIOReturnSuccess) return NULL;
  MVPixels pixels = {.base = IOSurfaceGetBaseAddress(surface), .row = IOSurfaceGetBytesPerRow(surface), .width = IOSurfaceGetWidth(surface), .height = IOSurfaceGetHeight(surface)};
  CGImageRef image = moodOf(&pixels, dark);
  IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  return image;
}

/// The spacing of an 8-bit image's colours where they have a plane of their own: an iPhone's stream is 4:4:4.
static BOOL spacingOf(OSType format, MVPixels *p) {
  switch (format) {
    case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange:
      p->columnsApart = 2, p->linesApart = 2;
      return YES;
    case kCVPixelFormatType_422YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_422YpCbCr8BiPlanarFullRange:
      p->columnsApart = 2, p->linesApart = 1;
      return YES;
    case kCVPixelFormatType_444YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_444YpCbCr8BiPlanarFullRange:
      p->columnsApart = 1, p->linesApart = 1;
      return YES;
    default:
      return NO;
  }
}

CGImageRef MVImageMood(CVImageBufferRef image, BOOL dark) {
  OSType format = CVPixelBufferGetPixelFormatType(image);
  MVPixels pixels = {.width = CVPixelBufferGetWidth(image), .height = CVPixelBufferGetHeight(image)};
  BOOL planes = spacingOf(format, &pixels);
  if ((!planes && format != kCVPixelFormatType_32BGRA) || CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return NULL;
  pixels.base = planes ? CVPixelBufferGetBaseAddressOfPlane(image, 0) : CVPixelBufferGetBaseAddress(image);
  pixels.row = planes ? CVPixelBufferGetBytesPerRowOfPlane(image, 0) : CVPixelBufferGetBytesPerRow(image);
  if (planes) {
    pixels.chroma = CVPixelBufferGetBaseAddressOfPlane(image, 1);
    pixels.chromaRow = CVPixelBufferGetBytesPerRowOfPlane(image, 1);
  }
  CGImageRef mood = moodOf(&pixels, dark);
  CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
  return mood;
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

- (BOOL)isDue {
  double now = MVNowMs();
  if (now - _at < kBackdropSeconds * 1000) return NO;
  _at = now;
  return YES;
}

- (BOOL)isDark {
  return [[_window.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
}

- (void)show:(nullable CGImageRef)mood {
  if (!mood) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _layer.contents = (__bridge id)mood;
  [CATransaction commit];
  CGImageRelease(mood);
}

- (void)followSurface:(IOSurfaceRef)surface {
  if ([self isDue]) [self show:MVPictureMood(surface, [self isDark])];
}

- (void)followImage:(CVImageBufferRef)image {
  if ([self isDue]) [self show:MVImageMood(image, [self isDark])];
}

@end
