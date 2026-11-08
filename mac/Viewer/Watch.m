// A `watch`: the decoded frames a window would show, made small and gray once, and read by MVMotion. Nothing here decodes.
#import "Motion.h"
#import "Viewer.h"
#import <Accelerate/Accelerate.h>
#import <AppKit/AppKit.h>

enum {
  /// About 1 sample to 2 tap units on a phone: a letter of a line of text still has a shape.
  MVWatchWidth = 360,
  MVStripFrames = 8,
  /// Each frame of a strip is one of this many samples of it, across and down.
  MVStripEvery = 2,
};

@implementation MVWatch {
  NSString *_name;
  double _ms, _firstAt;
  BOOL _strip;
  MVMotion *_motion;
  int _w, _h, _kept;
  NSMutableData *_gray;
  NSMutableData *_frames[MVStripFrames];
  double _keptAt[MVStripFrames];
}

- (instancetype)initWithId:(NSString *)name ms:(double)ms strip:(BOOL)strip {
  if ((self = [super init])) {
    _name = name;
    _ms = ms;
    _strip = strip;
  }
  return self;
}

/// The luma of a decoded frame, or the green of a screen's, as a wide plane the scaler takes; its turns put right after.
- (BOOL)fill:(CVImageBufferRef)image turns:(int)turns {
  size_t width = CVPixelBufferGetWidth(image), height = CVPixelBufferGetHeight(image);
  BOOL odd = turns % 2;
  int w = MVWatchWidth, h = (int)(MVWatchWidth * (odd ? width : height) / (odd ? height : width)) & ~1;
  if (!_gray) {
    _w = w, _h = h;
    _gray = [NSMutableData dataWithLength:w * h];
    _motion = [[MVMotion alloc] initWithWidth:w height:h];
  }
  if (w != _w || h != _h) return NO;
  OSType format = CVPixelBufferGetPixelFormatType(image);
  if (CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return NO;
  BOOL planes = CVPixelBufferGetPlaneCount(image) > 0;
  vImage_Buffer plane = {
      planes ? CVPixelBufferGetBaseAddressOfPlane(image, 0) : CVPixelBufferGetBaseAddress(image),
      planes ? CVPixelBufferGetHeightOfPlane(image, 0) : height,
      planes ? CVPixelBufferGetWidthOfPlane(image, 0) : width,
      planes ? CVPixelBufferGetBytesPerRowOfPlane(image, 0) : CVPixelBufferGetBytesPerRow(image),
  };
  NSMutableData *green = nil;
  if (!planes && format == kCVPixelFormatType_32BGRA) {
    green = [NSMutableData dataWithLength:width * height];
    vImage_Buffer out = {green.mutableBytes, height, width, width};
    vImageExtractChannel_ARGB8888(&plane, &out, 1, kvImageNoFlags);
    plane = out;
  } else if (!planes) {
    CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
    return NO;
  }
  NSMutableData *small = turns ? [NSMutableData dataWithLength:w * h] : nil;
  vImagePixelCount acrossBefore = odd ? h : w, downBefore = odd ? w : h;
  vImage_Buffer to = {(small ?: _gray).mutableBytes, downBefore, acrossBefore, acrossBefore};
  vImage_Error failed = vImageScale_Planar8(&plane, &to, NULL, kvImageHighQualityResampling);
  CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
  if (failed != kvImageNoError) return NO;
  if (turns) {
    vImage_Buffer turned = {_gray.mutableBytes, (vImagePixelCount)h, (vImagePixelCount)w, (size_t)w};
    vImageRotate90_Planar8(&to, &turned, (uint8_t)(turns & 3), 0, kvImageNoFlags);
  }
  return YES;
}

- (void)addImage:(CVImageBufferRef)image turns:(int)turns {
  if (![self fill:image turns:turns]) return;
  // a stream's frames by the device's clock: on the way here they bunch up, which is no fault of the screen.
  // Where it has none, as an iPhone's says 0 for every frame, by this Mac's.
  double captured = [CFBridgingRelease(CVBufferCopyAttachment(image, MVCapturedAt, NULL)) doubleValue];
  double at = captured > 0 ? captured : MVNowMs();
  if (!_started) _firstAt = at;
  _started = YES;
  double ms = at - _firstAt;
  [_motion addGray:_gray.bytes atMs:ms];
  if (_strip && _kept < MVStripFrames && ms >= _kept * _ms / (MVStripFrames - 1)) {
    _frames[_kept] = [_gray mutableCopy];
    _keptAt[_kept++] = ms;
  }
}

/// A file for this user alone, which the caller takes away: gray, as this is for what moved and not for how it looks.
- (nullable NSString *)writeStrip {
  int w = _w / MVStripEvery, h = _h / MVStripEvery, gap = 4;
  int total = _kept * w + (_kept - 1) * gap;
  NSMutableData *pixels = [NSMutableData dataWithLength:total * h];
  memset(pixels.mutableBytes, 255, pixels.length);
  for (int i = 0; i < _kept; i++) {
    const uint8_t *from = _frames[i].bytes;
    uint8_t *to = (uint8_t *)pixels.mutableBytes + i * (w + gap);
    for (int y = 0; y < h; y++, to += total)
      for (int x = 0; x < w; x++) to[x] = from[y * MVStripEvery * _w + x * MVStripEvery];
  }
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pixels);
  CGColorSpaceRef gray = CGColorSpaceCreateDeviceGray();
  CGImageRef picture = CGImageCreate(total, h, 8, 8, total, gray, (CGBitmapInfo)kCGImageAlphaNone, provider, NULL, NO, kCGRenderingIntentDefault);
  NSData *png = [[[NSBitmapImageRep alloc] initWithCGImage:picture] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  CGImageRelease(picture), CGColorSpaceRelease(gray), CGDataProviderRelease(provider);
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"appdyno-strip-%@-%d.png", _name, getpid()]];
  return [NSFileManager.defaultManager createFileAtPath:file contents:png attributes:@{NSFilePosixPermissions: @0600}] ? file : nil;
}

- (NSDictionary *)finish {
  NSMutableDictionary *said = [@{@"op": @"watched", @"id": _name, @"summary": _motion ? _motion.summary : @{@"frames": @0, @"ms": @0, @"noisy": @NO, @"regions": @[]}} mutableCopy];
  if (_strip && _kept > 0) {
    NSString *file = [self writeStrip];
    NSMutableArray *times = [NSMutableArray array];
    for (int i = 0; i < _kept; i++) [times addObject:@(_keptAt[i])];
    if (file) said[@"strip"] = @{@"file": file, @"at": times};
  }
  return said;
}

@end
