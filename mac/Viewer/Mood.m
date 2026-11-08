// A picture's own colours, in a few cells, for a layer to stretch into a soft mesh with no blur pass. A sparse sample
// on the window's thread: a surface is 32-bit, and a decoded stream is 8-bit 4:2:0 with its colours in a plane of their own.
#import "Viewer.h"
#import "Window.h"

enum { kMoodColumns = 5,
       kMoodRows = 9,
       kMoodSamples = 6 };
// the rate a backdrop follows its picture: it is mood, and costs nothing for being slow
static const double kBackdropSeconds = 2;
static const double kPlaceSeconds = 0.24;
// how far a picture's colour reaches and how strongly, how much colour in a picture counts as all of it, and its light in each look
static const double kMoodReach = 0.3, kMoodStrength = 0.9, kMoodFull = 60, kMoodDark = 0.66, kMoodLight = 0.68, kMoodSeconds = 0.3, kMoodSame = 0.02, kMoodLeft = 0.32;
static const float kMoodY = 0.56;

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
    out[0] = px[2] / 255.0;
    out[1] = px[1] / 255.0;
    out[2] = px[0] / 255.0;
    return;
  }
  const uint8_t *pair = p->chroma + y / p->linesApart * p->chromaRow + x / p->columnsApart * 2;
  // BT.709, as a video's range: a mood has no need of more, and a phone's stream is near enough to it
  double luma = (p->base[y * p->row] - 16) / 219.0, cb = (pair[0] - 128) / 224.0, cr = (pair[1] - 128) / 224.0;
  out[0] = unit(luma + 1.5748 * cr);
  out[1] = unit(luma - 0.1873 * cb - 0.4681 * cr);
  out[2] = unit(luma + 1.8556 * cb);
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

CF_RETURNS_RETAINED static CGImageRef moodOf(const MVPixels *p, BOOL dark) {
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
      p->columnsApart = 2;
      p->linesApart = 2;
      return YES;
    case kCVPixelFormatType_422YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_422YpCbCr8BiPlanarFullRange:
      p->columnsApart = 2;
      p->linesApart = 1;
      return YES;
    case kCVPixelFormatType_444YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_444YpCbCr8BiPlanarFullRange:
      p->columnsApart = 1;
      p->linesApart = 1;
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
  CALayer *_layer, *_grain;
  __weak NSWindow *_window;
  double _at[2];
  id _picture[2];
  BOOL _waiting[2];
  NSInteger _place;
  /// What the picture adds, each side of it, as colour and strength.
  MVGroundBloom _mood[2];
}

- (instancetype)initInView:(NSView *)view window:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    _layer = [CALayer layer];
    _layer.contentsGravity = kCAGravityResize;
    _layer.magnificationFilter = kCAFilterLinear;
    _layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    _layer.frame = view.bounds;
    _grain = [CALayer layer];
    _grain.backgroundColor = MVGrain();
    _grain.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    _grain.frame = view.bounds;
    [view.layer insertSublayer:_grain atIndex:0];
    [view.layer insertSublayer:_layer atIndex:0];
    [self repaint];
    __weak MVBackdrop *weak = self;
    [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification
                                                                object:nil
                                                                 queue:NSOperationQueue.mainQueue
                                                            usingBlock:^(__unused NSNotification *n) {
                                                              [weak settingsChanged];
                                                            }];
  }
  return self;
}

static void drawAgain(NSView *view) {
  view.needsDisplay = YES;
  for (NSView *child in view.subviews) drawAgain(child);
}

/// Colours are read as they are drawn, so a setting that changed needs only a drawing.
- (void)settingsChanged {
  [self repaint];
  drawAgain(_window.contentView);
}

- (BOOL)isDark {
  return MVIsDark(_window.effectiveAppearance);
}

- (void)paint {
  MVGroundPlan plan;
  MVGroundOf(self.isDark, _place, &plan);
  for (int i = 0; i < 2; i++)
    if (!_place && !MVSolidGrounds() && _mood[i].strength > 0 && plan.count < MVGroundBlooms) plan.blooms[plan.count++] = _mood[i];
  CGImageRef image = MVPaintGround(&plan);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _layer.contents = (__bridge id)image;
  [CATransaction commit];
  CGImageRelease(image);
}

- (void)repaint {
  [self paint];
}

/// What is painted next comes in over this long; at once for a person who asked for less motion.
- (void)fadeOver:(double)seconds {
  if (!MVMoves()) return;
  CATransition *fade = [CATransition animation];
  fade.type = kCATransitionFade;
  fade.duration = seconds;
  fade.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  [_layer addAnimation:fade forKey:@"ground"];
}

- (void)showPlace:(NSInteger)place {
  if (place == _place) return;
  _place = place;
  [self fadeOver:kPlaceSeconds];
  [self paint];
}

/// A hue at the ground's own light: dark stays dark and light stays light, whatever is on the screen.
static MVGroundBloom bloomOf(const uint8_t *bytes, size_t row, size_t tall, size_t from, size_t to, BOOL dark, double x) {
  double sum[3] = {0, 0, 0}, weight = 0;
  for (size_t y = 0; y < tall; y++)
    for (size_t at = from; at < to; at++) {
      const uint8_t *px = bytes + y * row + at * 4;
      double chroma = MAX(px[0], MAX(px[1], px[2])) - MIN(px[0], MIN(px[1], px[2]));
      for (int i = 0; i < 3; i++) sum[i] += px[i] * chroma;
      weight += chroma;
    }
  MVGroundBloom bloom = {(float)x, kMoodY, kMoodReach, 0, 0};
  if (weight < 1) return bloom;
  double top = MAX(sum[0], MAX(sum[1], sum[2])), low = MIN(sum[0], MIN(sum[1], sum[2])), level = dark ? kMoodDark : kMoodLight;
  uint32_t color = 0;
  for (int i = 0; i < 3; i++) {
    double share = sum[i] / top;
    color = color << 8 | (uint8_t)(255 * (dark ? level * share : 1 - (1 - share) * (1 - level)));
  }
  bloom.color = color;
  bloom.strength = (float)(MIN(1, weight / ((double)(to - from) * tall * kMoodFull)) * (top - low) / top * kMoodStrength);
  return bloom;
}

/// What a picture adds is its hue and no more: its light stays the ground's, so that nothing a device shows can reach what is read over it.
- (void)show:(nullable CGImageRef)CF_CONSUMED mood side:(NSInteger)side {
  if (!mood) return;
  MVGroundBloom was[2] = {_mood[0], _mood[1]};
  NSData *cells = CFBridgingRelease(CGDataProviderCopyData(CGImageGetDataProvider(mood)));
  size_t row = CGImageGetBytesPerRow(mood), wide = CGImageGetWidth(mood), tall = CGImageGetHeight(mood);
  BOOL dark = self.isDark;
  if (side < 0) {
    _mood[0] = bloomOf(cells.bytes, row, tall, 0, wide / 2 + 1, dark, kMoodLeft);
    _mood[1] = bloomOf(cells.bytes, row, tall, wide / 2, wide, dark, 1 - kMoodLeft);
  } else {
    _mood[side] = bloomOf(cells.bytes, row, tall, 0, wide, dark, side ? 1 - kMoodLeft : kMoodLeft);
  }
  CGImageRelease(mood);
  // a screen that stays as it was changes nothing, and is not painted
  if (fabs(was[0].strength - _mood[0].strength) + fabs(was[1].strength - _mood[1].strength) < kMoodSame && was[0].color == _mood[0].color && was[1].color == _mood[1].color) return;
  [self fadeOver:kMoodSeconds];
  [self paint];
}

- (void)sample:(NSInteger)at side:(NSInteger)side {
  id picture = _picture[at];
  _picture[at] = nil;
  _at[at] = MVNowMs();
  if (!picture) return;
  CFTypeRef held = (__bridge CFTypeRef)picture;
  [self show:CFGetTypeID(held) == IOSurfaceGetTypeID() ? MVPictureMood((IOSurfaceRef)held, self.isDark) : MVImageMood((CVImageBufferRef)held, self.isDark) side:side];
}

/// At most once in its time, and the last picture always: a screen that stops sends nothing more, and it is the one that stays.
- (void)follow:(id)picture side:(NSInteger)side {
  NSInteger at = MAX(side, 0);
  _picture[at] = picture;
  double wait = kBackdropSeconds * 1000 - (MVNowMs() - _at[at]);
  if (wait <= 0) return [self sample:at side:side];
  if (_waiting[at]) return;
  _waiting[at] = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    self->_waiting[at] = NO;
    [self sample:at side:side];
  });
}

- (void)followSurface:(IOSurfaceRef)surface side:(NSInteger)side {
  [self follow:(__bridge id)surface side:side];
}

- (void)followImage:(CVImageBufferRef)image side:(NSInteger)side {
  [self follow:(__bridge id)image side:side];
}

@end
