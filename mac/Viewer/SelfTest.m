// The viewer tested as it runs, with no device and no window: real frames through the real reader and
// decoder, bad input, and the arithmetic a window depends on. One JSON line per check, then the verdict.
#import "SelfTest.h"
#import "Place.h"
#import <Carbon/Carbon.h>
#import <arpa/inet.h>
#import <sys/socket.h>
#import <sys/stat.h>

static int gFailed;

void MVCheck(NSString *name, BOOL ok, NSString *_Nullable detail) {
  if (!ok) gFailed++;
  NSMutableDictionary *line = [@{@"check": name,
                                 @"ok": @(ok)} mutableCopy];
  if (detail) line[@"detail"] = detail;
  MVEmit(line);
}

void MVSkip(NSString *name, NSString *why) {
  MVEmit(@{@"check": name, @"skipped": why});
}

@implementation MVTestSink {
  MVStats *_stats;
}
- (instancetype)init {
  if ((self = [super init])) {
    _stats = [MVStats new];
    _captured = [NSCountedSet new];
  }
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
  NSNumber *captured = CFBridgingRelease(CVBufferCopyAttachment(image, MVCapturedAt, NULL));
  if (captured) @synchronized(self) {
      [_captured addObject:captured];
    }
  self.images++;
}
- (void)source:(id)from lost:(NSString *)why fatal:(BOOL)fatal {
  self.lost = why;
}
- (void)source:(id)from turns:(int)turns {
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
  // two threads write here, the test's and the one answering pings, and a frame must not take the other's in its middle
  @synchronized([MVTestSink class]) {
    writeBytes(fd, &big, 4);
    writeBytes(fd, &type, 1);
    writeBytes(fd, payload, length);
  }
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

/// Answers a stream's clock pings for as long as the connection lasts, as the agent does. On a number of its own: the test
/// closes `fd`, and the next socket takes that number, whose bytes this thread would then read.
static void answerRequests(int fd, void (^_Nullable onStart)(void)) {
  int own = dup(fd);
  [NSThread detachNewThreadWithBlock:^{
    for (;;) {
      uint8_t head[5];
      ssize_t got = 0;
      while (got < 5) {
        ssize_t n = read(own, head + got, 5 - got);
        if (n <= 0) goto done;
        got += n;
      }
      uint32_t length = ntohl(*(uint32_t *)head);
      if (length > 1 << 20) goto done;
      NSMutableData *body = [NSMutableData dataWithLength:length];
      size_t have = 0;
      while (have < length) {
        ssize_t n = read(own, (uint8_t *)body.mutableBytes + have, length - have);
        if (n <= 0) goto done;
        have += n;
      }
      NSDictionary *m = [NSJSONSerialization JSONObjectWithData:body options:0 error:NULL];
      if ([m[@"method"] isEqual:@"stream.clock"]) sendJson(own, @{@"id": m[@"id"],
                                                                  @"result": @{@"now": @(MVNowMs() * 1e6)}});
      else if ([m[@"method"] isEqual:@"stream.start"] && onStart) onStart();
    }
  done:
    close(own);
  }];
}

/// The agent hangs up: that thread's number keeps the socket open until it is told.
static void hangUp(int fd) {
  shutdown(fd, SHUT_RDWR);
  close(fd);
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
  MVForEachNal(two, sizeof two, ^(__unused const uint8_t *nal, size_t length) {
    if (count == 0) first = length;
    else second = length;
    count++;
  });
  MVCheck(@"nal: three- and four-byte starts", count == 2 && first == 2 && second == 5, nil);
  count = 0;
  MVForEachNal(two, 0, ^(__unused const uint8_t *nal, __unused size_t length) {
    count++;
  });
  const uint8_t cut[] = {0, 0, 1};
  MVForEachNal(cut, sizeof cut, ^(__unused const uint8_t *nal, __unused size_t length) {
    count++;
  });
  MVCheck(@"nal: empty and cut input", count == 0, nil);
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
  MVCheck(@"nal: random bytes stay in bounds", gFailed == 0 && seen > 0, nil);
}

/// Where the surface's corner that upright has at its top left comes to in the picture's parent.
static NSPoint uprightTopLeft(int turns, CGSize parent) {
  CALayer *root = [CALayer layer];
  root.frame = CGRectMake(0, 0, parent.width, parent.height);
  CALayer *picture = [CALayer layer];
  [root addSublayer:picture];
  MVLayoutTurned(picture, parent, turns);
  CGSize b = picture.bounds.size;
  // in layer coordinates, y up: what is a turned surface's corner, as a sideways picture has it
  CGPoint corner[4] = {{0, b.height}, {b.width, b.height}, {b.width, 0}, {0, 0}};
  return [root convertPoint:corner[turns] fromLayer:picture];
}

static void checkTurns(void) {
  // a guest turned once draws its top left at the surface's top right: a turn stands that at the picture's
  CGSize wide = {200, 100};
  NSPoint a = uprightTopLeft(1, wide);
  MVCheck(@"turns: one, the corner comes to the top left", fabs(a.x) < 1e-6 && fabs(a.y - 100) < 1e-6, NSStringFromPoint(a));
  NSPoint b = uprightTopLeft(3, wide);
  MVCheck(@"turns: three, the corner comes to the top left", fabs(b.x) < 1e-6 && fabs(b.y - 100) < 1e-6, NSStringFromPoint(b));
  CGSize tall = {100, 200};
  NSPoint c = uprightTopLeft(2, tall);
  MVCheck(@"turns: two, the corner comes to the top left", fabs(c.x) < 1e-6 && fabs(c.y - 200) < 1e-6, NSStringFromPoint(c));
  NSPoint d = uprightTopLeft(0, tall);
  MVCheck(@"turns: none, it stays", fabs(d.x) < 1e-6 && fabs(d.y - 200) < 1e-6, NSStringFromPoint(d));
}

static void checkInputMaths(void) {
  double x, y;
  CGSize device = {1080, 2400};
  BOOL inside = MVNormalize(NSMakePoint(135, 300), NSMakeSize(270, 600), device, &x, &y);
  MVCheck(@"map: the middle is the middle", inside && fabs(x - 0.5) < 1e-6 && fabs(y - 0.5) < 1e-6, nil);
  MVNormalize(NSMakePoint(0, 600), NSMakeSize(270, 600), device, &x, &y);
  MVCheck(@"map: the view's top left is the device's", fabs(x) < 1e-6 && fabs(y) < 1e-6, nil);
  // a picture narrower than the view: the bars at its sides are no part of the device
  BOOL bar = MVNormalize(NSMakePoint(10, 300), NSMakeSize(600, 600), device, &x, &y);
  MVCheck(@"map: nothing outside the picture", !bar, nil);
  inside = MVNormalize(NSMakePoint(300, 300), NSMakeSize(600, 600), device, &x, &y);
  MVCheck(@"map: inside a picture with bars", inside && fabs(x - 0.5) < 1e-6, nil);
  MVCheck(@"map: no picture yet is no touch", !MVNormalize(NSMakePoint(1, 1), NSMakeSize(10, 10), CGSizeZero, &x, &y), nil);
  MVCheck(@"keys: return, delete, arrows", MVUsageOfKeyCode(kVK_Return) == 0x28 && MVUsageOfKeyCode(kVK_Delete) == 0x2a && MVUsageOfKeyCode(kVK_UpArrow) == 0x52 && MVUsageOfKeyCode(kVK_ANSI_A) == 0, nil);
  MVCheck(@"keys: typed text", MVIsTypedText(@"a", 0) && MVIsTypedText(@"ş", 0) && !MVIsTypedText(@"a", NSEventModifierFlagCommand) && !MVIsTypedText(@"\r", 0) && !MVIsTypedText(@"", 0), nil);
}

static void checkCodec(BOOL hevc) {
  NSString *name = hevc ? @"hevc" : @"h264";
  NSArray<MVTestFrame *> *frames = MVEncodeFrames(hevc, 30, 10);
  if (frames.count < 15) return MVSkip(name, @"no encoder on this Mac");
  MVTestSink *sink = [MVTestSink new];
  __block BOOL started = NO;
  Connection c = connectStream(sink, hevc, ^{
    started = YES;
  });
  for (int i = 0; i < 100 && !started; i++) usleep(10000);
  MVCheck([name stringByAppendingString:@": asks to start"], started, nil);
  BOOL all = YES;
  int sent = 0;
  // one at a time, as a stream comes: a burst is dropped to its next key, as it should be
  for (MVTestFrame *frame in frames) {
    sendVideo(c.agent, frame.data);
    all = all && [sink waitForImages:++sent];
  }
  MVCheck([name stringByAppendingString:@": every frame decoded"], all, [NSString stringWithFormat:@"%d of %lu", sink.images, (unsigned long)frames.count]);
  MVCheck([name stringByAppendingString:@": its size"], sink.lastSize.width == 320 && sink.lastSize.height == 240, nil);
  NSDictionary *report = sink.stats.report;
  MVCheck([name stringByAppendingString:@": counted"], [report[@"arrived"] intValue] == (int)frames.count, [report description]);

  // a keyframe whose slices are broken: the decoder fails or says nothing, and the picture never shows it
  int requests = sink.keyRequests;
  NSMutableData *broken = [frames[0].data mutableCopy];
  uint8_t *bytes = broken.mutableBytes;
  __block size_t sliceAt = 0;
  MVForEachNal(bytes, broken.length, ^(const uint8_t *nal, __unused size_t length) {
    sliceAt = (size_t)(nal - bytes);
  });
  for (size_t i = sliceAt + 6; i < broken.length; i++) bytes[i] = (uint8_t)(i * 31);
  sendVideo(c.agent, broken);
  usleep(300000);
  MVCheck([name stringByAppendingString:@": a broken keyframe asks for another"], sink.keyRequests > requests && sink.lastFailures > 0, nil);
  int shownBefore = sink.images;
  sendVideo(c.agent, frames[0].data);
  MVCheck([name stringByAppendingString:@": a good keyframe after it shows"], [sink waitForImages:shownBefore + 1], nil);

  // a loss: the picture freezes, until a keyframe
  int before = sink.images;
  NSUInteger firstKey = [frames indexOfObjectPassingTest:^BOOL(MVTestFrame *f, NSUInteger i, __unused BOOL *stop) {
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
  MVCheck([name stringByAppendingString:@": no picture before a keyframe"], sink.images == before, [NSString stringWithFormat:@"%d then %d", before, sink.images]);
  if (firstKey != NSNotFound) {
    sendVideo(c.agent, frames[firstKey].data);
    MVCheck([name stringByAppendingString:@": a keyframe brings it back"], [sink waitForImages:before + 1], nil);
  }
  // a covered window reads frames and draws none
  before = sink.images;
  [c.source setHidden:YES];
  usleep(20000);
  sendVideo(c.agent, frames[0].data);
  usleep(200000);
  MVCheck([name stringByAppendingString:@": hidden draws nothing"], sink.images == before, nil);
  [c.source setHidden:NO];
  sendVideo(c.agent, frames[0].data);
  MVCheck([name stringByAppendingString:@": back with a keyframe"], [sink waitForImages:before + 1], nil);
  hangUp(c.agent);
  MVCheck([name stringByAppendingString:@": the end of the connection is seen"], [sink waitForLost], sink.lost);
  [c.source stop];
}

static void checkBroken(void) {
  MVTestSink *sink = [MVTestSink new];
  Connection c = connectStream(sink, NO, nil);
  uint32_t huge = htonl(0x7fffffff);
  uint8_t type = 2;
  writeBytes(c.agent, &huge, 4);
  writeBytes(c.agent, &type, 1);
  MVCheck(@"stream: a frame over the limit ends it", [sink waitForLost] && [sink.lost containsString:@"limit"], sink.lost);
  [c.source stop];
  hangUp(c.agent);

  sink = [MVTestSink new];
  c = connectStream(sink, NO, nil);
  const uint8_t junk[] = {1, 2, 3};
  sendFrame(c.agent, 2, junk, sizeof junk);
  sendFrame(c.agent, 9, junk, sizeof junk);
  sendFrame(c.agent, 0, junk, sizeof junk);
  sendVideo(c.agent, [NSData dataWithBytes:junk length:sizeof junk]);
  usleep(100000);
  MVCheck(@"stream: short and unknown frames are passed over", sink.lost == nil && sink.images == 0, sink.lost);
  sendJson(c.agent, @{@"id": @0,
                      @"error": @{@"message": @"no encoder took this display"}});
  MVCheck(@"stream: a refusal says why", [sink waitForLost] && [sink.lost containsString:@"encoder"], sink.lost);
  [c.source stop];
  hangUp(c.agent);
}

static void checkStats(void) {
  MVStats *stats = [MVStats new];
  for (int i = 1; i <= 100; i++) [stats arrived:1000 captureMs:i];
  [stats dropped:2];
  NSDictionary *r = stats.report;
  MVCheck(@"stats: counts and percentiles", [r[@"arrived"] intValue] == 100 && [r[@"dropped"] intValue] == 2 && [r[@"captureP50"] doubleValue] == 51 && [r[@"captureP95"] doubleValue] == 96 && [r[@"decodeP50"] doubleValue] == -1, r.description);
  MVCheck(@"stats: start anew", [stats.report[@"arrived"] intValue] == 0, nil);
  MVCheck(@"stats: what it costs", [r[@"rssMb"] doubleValue] > 0 && [r[@"fds"] intValue] > 0, nil);
  for (int i = 0; i < 10000; i++) [stats arrived:1 captureMs:i];
  MVCheck(@"stats: bounded", [stats.report[@"arrived"] intValue] == 10000, nil);
}

int MVSelfTest(NSString *fixtures) {
  // before any check, so that one failing cannot reach this Mac's pasteboard, which is a person's
  MVPlaceBehind(YES);
  // motion as a Mac with it on has it, whatever this one asks: GitHub's runners ask for less. A check of a cut holds still
  MVHoldStill(NO);
  MVTestMotion();
  checkNals();
  checkInputMaths();
  checkTurns();
  checkStats();
  MVCheckPixels();
  MVCheckPipe();
  MVCheckRecorder();
  MVCheckKeyboard();
  MVCheckFrame();
  MVCheckFlow();
  MVCheckShell();
  MVCheckPlaces();
  MVCheckConnect();
  MVCheckLinks();
  MVCheckPush();
  MVCheckDevice();
  checkBroken();
  checkCodec(NO);
  checkCodec(YES);
  MVCheckHevc444(fixtures);
  // the one way to a board, not the general board's count: that is the whole Mac's, and anything else copying moves it
  MVCheck(@"pasteboard: a viewer kept behind copies to a board of its own", ![MVPlaceBoard().name isEqual:NSPasteboardNameGeneral], nil);
  MVEmit(@{@"selftest": @"done",
           @"ok": @(gFailed == 0),
           @"failed": @(gFailed)});
  return gFailed ? 1 : 0;
}
