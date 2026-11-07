// The layers of a device's screen. A simulator's surface is shown as it is; a stream's images go to a display layer.
#import "Window.h"

// what replaces the layer's own enqueue and flush needs macOS 14, and these still work
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

void MVLayoutTurned(CALayer *layer, CGSize parent, int turns) {
  BOOL sideways = turns % 2;
  layer.bounds = CGRectMake(0, 0, sideways ? parent.height : parent.width, sideways ? parent.width : parent.height);
  layer.position = CGPointMake(parent.width / 2, parent.height / 2);
  layer.transform = CATransform3DMakeRotation(turns * M_PI_2, 0, 0, 1);
}

@implementation MVPictureLayers {
  __weak NSView *_view;
  CALayer *_plain;
  AVSampleBufferDisplayLayer *_video;
  CALayer *_dim;
  CALayer *_cutout;
}

- (instancetype)initInView:(NSView *)view {
  if ((self = [super init])) {
    _view = view;
    _plain = [self fill:[CALayer layer]];
    // laid out by hand: a layer turned on its side has no place in its parent's resizing
    _plain.autoresizingMask = kCALayerNotSizable;
    _plain.contentsGravity = kCAGravityResizeAspect;
    _video = (AVSampleBufferDisplayLayer *)[self fill:[AVSampleBufferDisplayLayer layer]];
    _video.autoresizingMask = kCALayerNotSizable;
    _video.videoGravity = AVLayerVideoGravityResizeAspect;
    _cutout = [self fill:[CALayer layer]];
    _cutout.autoresizingMask = kCALayerNotSizable;
    _cutout.backgroundColor = NSColor.blackColor.CGColor;
    _cutout.hidden = YES;
    _dim = [self fill:[CALayer layer]];
    _dim.backgroundColor = [NSColor colorWithWhite:0 alpha:0.6].CGColor;
    _dim.hidden = YES;
  }
  return self;
}

- (CALayer *)fill:(CALayer *)layer {
  layer.frame = _view.bounds;
  layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  [_view.layer addSublayer:layer];
  return layer;
}

- (void)showSurface:(IOSurfaceRef)surface {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // the same surface again shows nothing new unless the layer is told it changed
  _plain.contents = nil;
  _plain.contents = (__bridge id)surface;
  [CATransaction commit];
}

- (BOOL)showImage:(CVImageBufferRef)image {
  CMVideoFormatDescriptionRef format = NULL;
  if (CMVideoFormatDescriptionCreateForImageBuffer(NULL, image, &format) != noErr) return NO;
  CMSampleTimingInfo timing = {.duration = kCMTimeInvalid, .presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock()), .decodeTimeStamp = kCMTimeInvalid};
  CMSampleBufferRef sample = NULL;
  OSStatus status = CMSampleBufferCreateReadyWithImageBuffer(NULL, image, format, &timing, &sample);
  CFRelease(format);
  if (status != noErr) return NO;
  CFMutableDictionaryRef attachments = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(CMSampleBufferGetSampleAttachmentsArray(sample, YES), 0);
  CFDictionarySetValue(attachments, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
  BOOL failed = _video.status == AVQueuedSampleBufferRenderingStatusFailed;
  if (failed) [_video flush];
  [_video enqueueSampleBuffer:sample];
  CFRelease(sample);
  return !failed;
}

- (void)setDimmed:(BOOL)dimmed {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _dim.hidden = !dimmed;
  [CATransaction commit];
}

- (void)layOut:(CGSize)screen turns:(int)turns cutout:(CGRect)cut {
  MVLayoutTurned(_plain, screen, turns);
  MVLayoutTurned(_video, screen, turns);
  BOOL sideways = screen.width > screen.height;
  double high = sideways ? screen.width : screen.height, wide = sideways ? screen.height : screen.width;
  _cutout.hidden = CGRectIsEmpty(cut);
  // the layer's origin is at the bottom left; a turned device has its top at the window's left
  _cutout.frame = sideways ? CGRectMake(cut.origin.y, wide - CGRectGetMaxX(cut), cut.size.height, cut.size.width)
                           : CGRectMake(cut.origin.x, high - CGRectGetMaxY(cut), cut.size.width, cut.size.height);
  _cutout.cornerRadius = MIN(cut.size.width, cut.size.height) / 2;
}

@end
