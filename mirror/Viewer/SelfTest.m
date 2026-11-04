// The viewer tested as it runs, with no device and no window: real frames through the real reader and
// decoder, bad input, and the arithmetic a window depends on. One JSON line per check, then the verdict.
#import "SelfTest.h"
#import <Carbon/Carbon.h>
#import <arpa/inet.h>
#import <sys/socket.h>
#import <sys/stat.h>

static int gFailed;

static void check(NSString *name, BOOL ok, NSString *_Nullable detail) {
  if (!ok) gFailed++;
  NSMutableDictionary *line = [@{@"check": name, @"ok": @(ok)} mutableCopy];
  if (detail) line[@"detail"] = detail;
  MVEmit(line);
}

static void skip(NSString *name, NSString *why) {
  MVEmit(@{@"check": name, @"skipped": why});
}

/// A sink that counts, and lets a check wait until a count is reached.
@interface MVTestSink : NSObject <MVSink>
@property(atomic) int images, surfaces, sizes;
@property(atomic, copy, nullable) NSString *lost;
@property(atomic) CGSize lastSize;
@property(atomic, copy, nullable) NSString *lastCodec;
@property(atomic) OSType lastFormat;
@property(atomic, nullable) id lastImage;
@property(atomic, nullable) id lastSurface;
@property(atomic) int keyRequests, lastFailures;
@end

@implementation MVTestSink {
  MVStats *_stats;
}
- (instancetype)init {
  if ((self = [super init])) _stats = [MVStats new];
  return self;
}
- (MVStats *)stats {
  return _stats;
}
- (void)source:(id)from size:(CGSize)size codec:(NSString *)codec {
  self.sizes++;
  self.lastSize = size;
  self.lastCodec = codec;
}
- (void)source:(id)from surface:(IOSurfaceRef)surface {
  self.lastSurface = (__bridge id)surface;
  self.surfaces++;
}
- (void)source:(id)from image:(CVImageBufferRef)image {
  self.lastFormat = CVPixelBufferGetPixelFormatType(image);
  self.lastImage = (__bridge id)image;
  self.images++;
}
- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal {
  self.lost = why;
}
- (void)source:(id)from needsKey:(int)failures {
  self.keyRequests++;
  self.lastFailures = failures;
}
- (BOOL)waitForKeyRequests:(int)count {
  for (int i = 0; i < 300 && self.keyRequests < count; i++) usleep(10000);
  return self.keyRequests >= count;
}
- (BOOL)waitForImages:(int)count {
  for (int i = 0; i < 1000 && self.images < count; i++) usleep(10000);
  return self.images >= count;
}
- (BOOL)waitForLost {
  for (int i = 0; i < 500 && !self.lost; i++) usleep(10000);
  return self.lost != nil;
}
@end

static void writeBytes(int fd, const void *from, size_t length) {
  const uint8_t *p = from;
  while (length) {
    ssize_t put = write(fd, p, length);
    if (put <= 0) return;
    p += put;
    length -= put;
  }
}

static void sendFrame(int fd, uint8_t type, const void *payload, size_t length) {
  uint32_t big = htonl((uint32_t)length);
  writeBytes(fd, &big, 4);
  writeBytes(fd, &type, 1);
  writeBytes(fd, payload, length);
}

static void sendJson(int fd, NSDictionary *message) {
  NSData *body = [NSJSONSerialization dataWithJSONObject:message options:0 error:NULL];
  sendFrame(fd, 0, body.bytes, body.length);
}

static void sendVideo(int fd, NSData *frame) {
  NSMutableData *payload = [NSMutableData dataWithLength:20];
  [payload appendData:frame];
  sendFrame(fd, 2, payload.bytes, payload.length);
}

/// Answers a stream's clock pings for as long as the connection lasts, as the agent does.
static void answerRequests(int fd, void (^_Nullable onStart)(void)) {
  [NSThread detachNewThreadWithBlock:^{
    for (;;) {
      uint8_t head[5];
      ssize_t got = 0;
      while (got < 5) {
        ssize_t n = read(fd, head + got, 5 - got);
        if (n <= 0) return;
        got += n;
      }
      uint32_t length = ntohl(*(uint32_t *)head);
      if (length > 1 << 20) return;
      NSMutableData *body = [NSMutableData dataWithLength:length];
      size_t have = 0;
      while (have < length) {
        ssize_t n = read(fd, (uint8_t *)body.mutableBytes + have, length - have);
        if (n <= 0) return;
        have += n;
      }
      NSDictionary *m = [NSJSONSerialization JSONObjectWithData:body options:0 error:NULL];
      if ([m[@"method"] isEqual:@"stream.clock"]) sendJson(fd, @{@"id": m[@"id"], @"result": @{@"now": @(MVNowMs() * 1e6)}});
      else if ([m[@"method"] isEqual:@"stream.start"] && onStart) onStart();
    }
  }];
}

typedef struct {
  MVSourceStream *source;
  int agent;
} Connection;

static Connection connectStream(MVTestSink *sink, BOOL hevc, void (^_Nullable onStart)(void)) {
  int pair[2];
  socketpair(AF_UNIX, SOCK_STREAM, 0, pair);
  int on = 1;
  setsockopt(pair[0], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
  setsockopt(pair[1], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
  MVSourceStream *source = [[MVSourceStream alloc] initWithOptions:@{@"token": @"t", @"codec": hevc ? @"hevc" : @"h264"} sink:sink];
  answerRequests(pair[1], onStart);
  [source runOnDescriptor:pair[0]];
  return (Connection){source, pair[1]};
}

static void checkNals(void) {
  const uint8_t two[] = {0, 0, 0, 1, 0x67, 0xAA, 0, 0, 1, 0x68, 0xBB, 0, 0, 0};
  __block int count = 0;
  __block size_t first = 0, second = 0;
  MVForEachNal(two, sizeof two, ^(const uint8_t *nal, size_t length) {
    if (count == 0) first = length;
    else second = length;
    count++;
  });
  check(@"nal: three- and four-byte starts", count == 2 && first == 2 && second == 5, nil);
  count = 0;
  MVForEachNal(two, 0, ^(const uint8_t *nal, size_t length) {
    count++;
  });
  const uint8_t cut[] = {0, 0, 1};
  MVForEachNal(cut, sizeof cut, ^(const uint8_t *nal, size_t length) {
    count++;
  });
  check(@"nal: empty and cut input", count == 0, nil);
  // bytes as an enemy would send them: the checks are in the bounds, and a crash fails the whole run
  enum { kNoise = 4096 };
  uint8_t bytes[kNoise];
  uint8_t *noise = bytes;
  srand48(7);
  __block size_t seen = 0;
  for (int round = 0; round < 200; round++) {
    for (size_t i = 0; i < kNoise; i++) noise[i] = (uint8_t)(lrand48() % (round % 2 ? 2 : 256));
    MVForEachNal(noise, kNoise, ^(const uint8_t *nal, size_t length) {
      if (nal >= noise && nal + length <= noise + kNoise) seen++;
      else gFailed++;
    });
  }
  check(@"nal: random bytes stay in bounds", gFailed == 0 && seen > 0, nil);
}

static void checkInputMaths(void) {
  double x, y;
  CGSize device = {1080, 2400};
  BOOL inside = MVNormalize(NSMakePoint(135, 300), NSMakeSize(270, 600), device, &x, &y);
  check(@"map: the middle is the middle", inside && fabs(x - 0.5) < 1e-6 && fabs(y - 0.5) < 1e-6, nil);
  MVNormalize(NSMakePoint(0, 600), NSMakeSize(270, 600), device, &x, &y);
  check(@"map: the view's top left is the device's", fabs(x) < 1e-6 && fabs(y) < 1e-6, nil);
  // a picture narrower than the view: the bars at its sides are no part of the device
  BOOL bar = MVNormalize(NSMakePoint(10, 300), NSMakeSize(600, 600), device, &x, &y);
  check(@"map: nothing outside the picture", !bar, nil);
  inside = MVNormalize(NSMakePoint(300, 300), NSMakeSize(600, 600), device, &x, &y);
  check(@"map: inside a picture with bars", inside && fabs(x - 0.5) < 1e-6, nil);
  check(@"map: no picture yet is no touch", !MVNormalize(NSMakePoint(1, 1), NSMakeSize(10, 10), CGSizeZero, &x, &y), nil);
  check(@"keys: return, delete, arrows", MVUsageOfKeyCode(kVK_Return) == 0x28 && MVUsageOfKeyCode(kVK_Delete) == 0x2a && MVUsageOfKeyCode(kVK_UpArrow) == 0x52 && MVUsageOfKeyCode(kVK_ANSI_A) == 0, nil);
  check(@"keys: typed text", MVIsTypedText(@"a", 0) && MVIsTypedText(@"ş", 0) && !MVIsTypedText(@"a", NSEventModifierFlagCommand) && !MVIsTypedText(@"\r", 0) && !MVIsTypedText(@"", 0), nil);
}

static void checkCodec(BOOL hevc) {
  NSString *name = hevc ? @"hevc" : @"h264";
  NSArray<MVTestFrame *> *frames = MVEncodeFrames(hevc, 30, 10);
  if (frames.count < 15) return skip(name, @"no encoder on this Mac");
  MVTestSink *sink = [MVTestSink new];
  __block BOOL started = NO;
  Connection c = connectStream(sink, hevc, ^{
    started = YES;
  });
  for (int i = 0; i < 100 && !started; i++) usleep(10000);
  check([name stringByAppendingString:@": asks to start"], started, nil);
  for (MVTestFrame *frame in frames) sendVideo(c.agent, frame.data);
  BOOL all = [sink waitForImages:(int)frames.count];
  check([name stringByAppendingString:@": every frame decoded"], all, [NSString stringWithFormat:@"%d of %lu", sink.images, (unsigned long)frames.count]);
  check([name stringByAppendingString:@": its size"], sink.lastSize.width == 320 && sink.lastSize.height == 240, nil);
  NSDictionary *report = sink.stats.report;
  check([name stringByAppendingString:@": counted"], [report[@"arrived"] intValue] == (int)frames.count, [report description]);

  // a keyframe whose slices are broken: the decoder fails or says nothing, and the picture never shows it
  int requests = sink.keyRequests;
  NSMutableData *broken = [frames[0].data mutableCopy];
  uint8_t *bytes = broken.mutableBytes;
  __block size_t sliceAt = 0;
  MVForEachNal(bytes, broken.length, ^(const uint8_t *nal, size_t length) {
    sliceAt = (size_t)(nal - bytes);
  });
  for (size_t i = sliceAt + 6; i < broken.length; i++) bytes[i] = (uint8_t)(i * 31);
  sendVideo(c.agent, broken);
  usleep(300000);
  check([name stringByAppendingString:@": a broken keyframe asks for another"], sink.keyRequests > requests && sink.lastFailures > 0, nil);
  int shownBefore = sink.images;
  sendVideo(c.agent, frames[0].data);
  check([name stringByAppendingString:@": a good keyframe after it shows"], [sink waitForImages:shownBefore + 1], nil);

  // a loss: the picture freezes, until a keyframe
  int before = sink.images;
  NSUInteger firstKey = [frames indexOfObjectPassingTest:^BOOL(MVTestFrame *f, NSUInteger i, BOOL *stop) {
    return i > 0 && f.key;
  }];
  NSMutableData *garbage = [frames[1].data mutableCopy];
  for (NSUInteger i = 8; i < garbage.length; i++) ((uint8_t *)garbage.mutableBytes)[i] ^= 0x5a;
  [sink.stats report];
  [c.source setHidden:YES];
  [c.source setHidden:NO];
  sendVideo(c.agent, garbage);
  sendVideo(c.agent, frames[2].data);
  usleep(200000);
  check([name stringByAppendingString:@": no picture before a keyframe"], sink.images == before, [NSString stringWithFormat:@"%d then %d", before, sink.images]);
  if (firstKey != NSNotFound) {
    sendVideo(c.agent, frames[firstKey].data);
    check([name stringByAppendingString:@": a keyframe brings it back"], [sink waitForImages:before + 1], nil);
  }
  // a covered window reads frames and draws none
  before = sink.images;
  [c.source setHidden:YES];
  usleep(20000);
  sendVideo(c.agent, frames[0].data);
  usleep(200000);
  check([name stringByAppendingString:@": hidden draws nothing"], sink.images == before, nil);
  [c.source setHidden:NO];
  sendVideo(c.agent, frames[0].data);
  check([name stringByAppendingString:@": back with a keyframe"], [sink waitForImages:before + 1], nil);
  close(c.agent);
  check([name stringByAppendingString:@": the end of the connection is seen"], [sink waitForLost], sink.lost);
  [c.source stop];
}

static void checkBroken(void) {
  MVTestSink *sink = [MVTestSink new];
  Connection c = connectStream(sink, NO, nil);
  uint32_t huge = htonl(0x7fffffff);
  uint8_t type = 2;
  writeBytes(c.agent, &huge, 4);
  writeBytes(c.agent, &type, 1);
  check(@"stream: a frame over the limit ends it", [sink waitForLost] && [sink.lost containsString:@"limit"], sink.lost);
  [c.source stop];
  close(c.agent);

  sink = [MVTestSink new];
  c = connectStream(sink, NO, nil);
  const uint8_t junk[] = {1, 2, 3};
  sendFrame(c.agent, 2, junk, sizeof junk);
  sendFrame(c.agent, 9, junk, sizeof junk);
  sendFrame(c.agent, 0, junk, sizeof junk);
  sendVideo(c.agent, [NSData dataWithBytes:junk length:sizeof junk]);
  usleep(100000);
  check(@"stream: short and unknown frames are passed over", sink.lost == nil && sink.images == 0, sink.lost);
  sendJson(c.agent, @{@"id": @0, @"error": @{@"message": @"no encoder took this display"}});
  check(@"stream: a refusal says why", [sink waitForLost] && [sink.lost containsString:@"encoder"], sink.lost);
  [c.source stop];
  close(c.agent);
}

/// Whether the layer a window uses takes a picture of this kind; it needs no window to say so.
static void checkLayerTakes444(CVImageBufferRef _Nullable image) {
  if (!image) return skip(@"4:4:4: the layer", @"no picture to show it");
  CMVideoFormatDescriptionRef format = NULL;
  CMVideoFormatDescriptionCreateForImageBuffer(NULL, image, &format);
  CMSampleTimingInfo timing = {.duration = kCMTimeInvalid, .presentationTimeStamp = kCMTimeZero, .decodeTimeStamp = kCMTimeInvalid};
  CMSampleBufferRef sample = NULL;
  CMSampleBufferCreateReadyWithImageBuffer(NULL, image, format, &timing, &sample);
  if (format) CFRelease(format);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  AVSampleBufferDisplayLayer *layer = [AVSampleBufferDisplayLayer layer];
  [layer enqueueSampleBuffer:sample];
  usleep(200000);
  check(@"4:4:4: the layer takes it", layer.status != AVQueuedSampleBufferRenderingStatusFailed, layer.error.description);
#pragma clang diagnostic pop
  if (sample) CFRelease(sample);
}

static void checkHevc444(NSString *_Nullable fixtures) {
  NSString *file = [fixtures stringByAppendingPathComponent:@"hevc444.hevc"];
  NSData *stream = file ? [NSData dataWithContentsOfFile:file] : nil;
  if (!stream) return skip(@"4:4:4", @"no fixture given");
  // the fixture's frames, one by one: each VCL unit with what comes before it
  MVTestSink *sink = [MVTestSink new];
  MVDecoder *decoder = [[MVDecoder alloc] initWithSink:sink from:sink];
  decoder.hevc = YES;
  __block int pictures = 0;
  MVForEachNal(stream.bytes, stream.length, ^(const uint8_t *nal, size_t length) {
    uint8_t start[3] = {0, 0, 1};
    NSMutableData *unit = [NSMutableData dataWithBytes:start length:3];
    [unit appendBytes:nal length:length];
    if (((nal[0] >> 1) & 0x3f) < 32) pictures++;
    [decoder decode:unit.bytes length:unit.length];
  });
  BOOL decoded = [sink waitForImages:pictures];
  check(@"4:4:4: every frame decoded", pictures > 0 && decoded, [NSString stringWithFormat:@"%d of %d", sink.images, pictures]);
  OSType format = sink.lastFormat;
  BOOL full = format == kCVPixelFormatType_444YpCbCr8BiPlanarVideoRange || format == kCVPixelFormatType_444YpCbCr8BiPlanarFullRange || format == kCVPixelFormatType_444YpCbCr10BiPlanarVideoRange || format == kCVPixelFormatType_444YpCbCr10BiPlanarFullRange;
  check(@"4:4:4: stays 4:4:4 out of the decoder", full, [NSString stringWithFormat:@"%c%c%c%c", (char)(format >> 24), (char)(format >> 16), (char)(format >> 8), (char)format]);
  [decoder close];
  checkLayerTakes444((__bridge CVImageBufferRef)sink.lastImage);
}

static void checkPixels(void) {
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".rgba"]];
  const int w = 16, h = 8;
  NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
  uint8_t *p = pixels.mutableBytes;
  for (int i = 0; i < w * h; i++) {
    p[i * 4] = 10;
    p[i * 4 + 1] = 20;
    p[i * 4 + 2] = 30;
    p[i * 4 + 3] = 255;
  }
  [pixels writeToFile:file atomically:NO];
  chmod(file.fileSystemRepresentation, 0600);
  MVTestSink *sink = [MVTestSink new];
  MVSourcePixels *source = [[MVSourcePixels alloc] initWithOptions:@{@"file": file} sink:sink];
  [source start];
  [source tick:@{@"w": @(w), @"h": @(h)}];
  for (int i = 0; i < 300 && !sink.surfaces; i++) usleep(10000);
  check(@"pixels: a tick shows a frame", sink.surfaces > 0, nil);
  IOSurfaceRef surface = (__bridge IOSurfaceRef)sink.lastSurface;
  if (surface) {
    IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL);
    uint8_t *bgra = IOSurfaceGetBaseAddress(surface);
    check(@"pixels: red and blue swapped, nothing else", bgra[0] == 30 && bgra[1] == 20 && bgra[2] == 10 && bgra[3] == 255, nil);
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  }
  check(@"pixels: its size", sink.lastSize.width == w && sink.lastSize.height == h, nil);
  [source tick:@{@"w": @(w * 100), @"h": @(h * 100)}];
  check(@"pixels: a size past the file is refused, unread", [sink waitForLost], sink.lost);
  [source stop];
  [[NSFileManager defaultManager] removeItemAtPath:file error:NULL];
  sink = [MVTestSink new];
  source = [[MVSourcePixels alloc] initWithOptions:@{@"file": @"/no/such/file"} sink:sink];
  [source start];
  check(@"pixels: a missing file says so", [sink waitForLost], sink.lost);
  [source stop];
}

static void checkStats(void) {
  MVStats *stats = [MVStats new];
  for (int i = 1; i <= 100; i++) [stats arrived:1000 captureMs:i];
  [stats dropped:2];
  NSDictionary *r = stats.report;
  check(@"stats: counts and percentiles", [r[@"arrived"] intValue] == 100 && [r[@"dropped"] intValue] == 2 && [r[@"captureP50"] doubleValue] == 51 && [r[@"captureP95"] doubleValue] == 96 && [r[@"decodeP50"] doubleValue] == -1, r.description);
  check(@"stats: start anew", [stats.report[@"arrived"] intValue] == 0, nil);
  check(@"stats: what it costs", [r[@"rssMb"] doubleValue] > 0 && [r[@"fds"] intValue] > 0, nil);
  for (int i = 0; i < 10000; i++) [stats arrived:1 captureMs:i];
  check(@"stats: bounded", [stats.report[@"arrived"] intValue] == 10000, nil);
}

int MVSelfTest(NSString *fixtures) {
  checkNals();
  checkInputMaths();
  checkStats();
  checkPixels();
  checkBroken();
  checkCodec(NO);
  checkCodec(YES);
  checkHevc444(fixtures);
  MVEmit(@{@"selftest": @"done", @"ok": @(gFailed == 0), @"failed": @(gFailed)});
  return gFailed ? 1 : 0;
}
