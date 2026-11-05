// The self test of the sources that read a file: an emulator's frame, and a stream on a named pipe.
#import "Place.h"
#import "SelfTest.h"
#import "Words.h"
#import "Window.h"
#import <AVFoundation/AVFoundation.h>
#import <Accelerate/Accelerate.h>
#import <fcntl.h>
#import <sys/stat.h>

void MVCheckPixels(void) {
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
  MVCheck(@"pixels: a tick shows a frame", sink.surfaces > 0, nil);
  IOSurfaceRef surface = (__bridge IOSurfaceRef)sink.lastSurface;
  if (surface) {
    IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL);
    uint8_t *bgra = IOSurfaceGetBaseAddress(surface);
    MVCheck(@"pixels: red and blue swapped, nothing else", bgra[0] == 30 && bgra[1] == 20 && bgra[2] == 10 && bgra[3] == 255, nil);
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  }
  MVCheck(@"pixels: its size", sink.lastSize.width == w && sink.lastSize.height == h, nil);
  // a quarter turn: the frame's size swaps, and its top left corner comes to the bottom left
  ((uint8_t *)pixels.mutableBytes)[0] = 200;
  [pixels writeToFile:file atomically:NO];
  int shown = sink.surfaces;
  [source tick:@{@"w": @(w), @"h": @(h), @"turns": @1}];
  for (int i = 0; i < 300 && sink.surfaces == shown; i++) usleep(10000);
  MVCheck(@"pixels: a turn swaps the size", sink.lastSize.width == h && sink.lastSize.height == w, nil);
  surface = (__bridge IOSurfaceRef)sink.lastSurface;
  if (surface) {
    IOSurfaceLock(surface, kIOSurfaceLockReadOnly, NULL);
    uint8_t *turned = IOSurfaceGetBaseAddress(surface);
    size_t row = IOSurfaceGetBytesPerRow(surface);
    MVCheck(@"pixels: a turn moves the corner", turned[row * (w - 1) + 2] == 200 && turned[2] == 10, nil);
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, NULL);
  }
  [source tick:@{@"w": @(w * 100), @"h": @(h * 100)}];
  MVCheck(@"pixels: a size past the file is refused, unread", [sink waitForLost], sink.lost);
  [source stop];
  [[NSFileManager defaultManager] removeItemAtPath:file error:NULL];
  sink = [MVTestSink new];
  source = [[MVSourcePixels alloc] initWithOptions:@{@"file": @"/no/such/file"} sink:sink];
  [source start];
  MVCheck(@"pixels: a missing file says so", [sink waitForLost], sink.lost);
  [source stop];
}

/// One frame as a stream has it: 32 bits of length, then its type.
static void writeFrame(int fd, uint8_t type, const void *header, size_t headerLength, NSData *body) {
  uint32_t length = htonl((uint32_t)(headerLength + body.length));
  uint8_t head[5];
  memcpy(head, &length, 4);
  head[4] = type;
  NSMutableData *all = [NSMutableData dataWithBytes:head length:5];
  if (headerLength) [all appendBytes:header length:headerLength];
  [all appendData:body];
  const uint8_t *p = all.bytes;
  size_t left = all.length;
  while (left) {
    ssize_t put = write(fd, p, left);
    if (put < 0 && errno == EAGAIN) {
      usleep(1000);
      continue;
    }
    if (put <= 0) return;
    p += put;
    left -= (size_t)put;
  }
}

void MVCheckPipe(void) {
  NSArray<MVTestFrame *> *frames = MVEncodeFrames(YES, 12, 6);
  if (frames.count < 6) return MVSkip(@"pipe", @"no encoder on this Mac");
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID UUID].UUIDString];
  if (mkfifo(file.fileSystemRepresentation, 0600) != 0) return MVCheck(@"pipe: made", NO, @(strerror(errno)));
  MVTestSink *sink = [MVTestSink new];
  MVSourceStream *source = [[MVSourceStream alloc] initWithOptions:@{@"kind": @"pipe", @"file": file, @"codec": @"hevc"} sink:sink];
  [source start];
  int writer = -1;
  for (int i = 0; i < 300 && writer < 0; i++) {
    writer = open(file.fileSystemRepresentation, O_WRONLY | O_NONBLOCK);
    if (writer < 0) usleep(10000);
  }
  MVCheck(@"pipe: the viewer holds it open", writer >= 0, nil);
  unlink(file.fileSystemRepresentation);
  if (writer < 0) return [source stop];
  NSDictionary *info = @{@"method": @"stream.info", @"params": @{@"w": @320, @"h": @240, @"codec": @"hevc", @"mode": @"mode 7"}};
  writeFrame(writer, 0, NULL, 0, [NSJSONSerialization dataWithJSONObject:info options:0 error:NULL]);
  uint8_t zero[20] = {0};
  // one at a time, as a stream comes: a burst is dropped to its next key, as it should be
  BOOL all = YES;
  int sent = 0;
  for (MVTestFrame *frame in frames) {
    writeFrame(writer, 2, zero, sizeof zero, frame.data);
    all = all && [sink waitForImages:++sent];
  }
  MVCheck(@"pipe: every frame decoded", all, [NSString stringWithFormat:@"%d of %lu", sink.images, (unsigned long)frames.count]);
  MVCheck(@"pipe: the size it was told", sink.lastSize.width == 320 && sink.lastSize.height == 240, nil);
  MVCheck(@"pipe: the mode it was told", [sink.stats.mode isEqual:@"mode 7"], sink.stats.mode);
  // a coded picture larger than the screen: what the stream says is what shows, from its top left
  NSDictionary *cropped = @{@"method": @"stream.info", @"params": @{@"w": @300, @"h": @200, @"codec": @"hevc", @"mode": @"mode 5", @"crop": @YES}};
  writeFrame(writer, 0, NULL, 0, [NSJSONSerialization dataWithJSONObject:cropped options:0 error:NULL]);
  int before = sink.images;
  writeFrame(writer, 2, zero, sizeof zero, frames[0].data);
  [sink waitForImages:before + 1];
  CGRect clean = CVImageBufferGetCleanRect((__bridge CVImageBufferRef)sink.lastImage);
  MVCheck(@"pipe: a crop keeps the picture's top left", clean.size.width == 300 && clean.size.height == 200 && clean.origin.x == 0, NSStringFromRect(NSRectFromCGRect(clean)));
  NSDictionary *counters = @{@"method": @"stream.counters", @"params": @{@"lostPackets": @7}};
  writeFrame(writer, 0, NULL, 0, [NSJSONSerialization dataWithJSONObject:counters options:0 error:NULL]);
  for (int i = 0; i < 100 && !sink.stats.counters; i++) usleep(10000);
  MVCheck(@"pipe: what the stream counts is in the stats", [sink.stats.report[@"lostPackets"] intValue] == 7, nil);
  // with what writes still there and silent, as a viewer told to let go has it
  NSDate *began = [NSDate date];
  [source stop];
  MVCheck(@"pipe: a silent stream stops at once", -began.timeIntervalSinceNow < 2, [NSString stringWithFormat:@"%.2f s", -began.timeIntervalSinceNow]);
  MVCheck(@"pipe: nothing said of a stop", sink.lost == nil, sink.lost);
  close(writer);
}

void MVCheckRecorder(void) {
  NSArray<MVTestFrame *> *frames = MVEncodeFrames(YES, 30, 10);
  if (frames.count < 15) return MVSkip(@"recorder", @"no encoder on this Mac");
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID].UUIDString stringByAppendingString:@".mp4"]];
  MVTestSink *sink = [MVTestSink new];
  MVDecoder *decoder = [[MVDecoder alloc] initWithSink:sink from:sink];
  decoder.hevc = YES;
  MVRecorder *recorder = [[MVRecorder alloc] initWithFile:file];
  decoder.recorder = recorder;
  MVCheck(@"recorder: wants a key first", recorder.wantsKey, nil);
  // frames that come before a key are no start: the test leaves out the first key
  for (NSUInteger i = 1; i < frames.count; i++) {
    [decoder decode:frames[i].data.bytes length:frames[i].data.length];
    usleep(16000);
  }
  usleep(200000);
  NSDictionary *told = [recorder finish];
  [decoder close];
  long expected = (long)frames.count - 10;
  MVCheck(@"recorder: from the first key on", [told[@"frames"] longValue] == expected, told.description);
  MVCheck(@"recorder: ended as asked", told[@"why"] == nil, told[@"why"]);
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:file] options:nil];
  __block NSArray *tracks = nil;
  dispatch_semaphore_t loaded = dispatch_semaphore_create(0);
  [asset loadTracksWithMediaType:AVMediaTypeVideo completionHandler:^(NSArray *found, NSError *error) {
    tracks = found;
    dispatch_semaphore_signal(loaded);
  }];
  dispatch_semaphore_wait(loaded, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
  MVCheck(@"recorder: a movie that opens", tracks.count == 1, nil);
  [NSFileManager.defaultManager removeItemAtPath:file error:NULL];

  MVRecorder *nowhere = [[MVRecorder alloc] initWithFile:@"/nonexistent/folder/movie.mp4"];
  MVDecoder *second = [[MVDecoder alloc] initWithSink:sink from:sink];
  second.hevc = YES;
  second.recorder = nowhere;
  [second decode:frames[0].data.bytes length:frames[0].data.length];
  usleep(100000);
  NSDictionary *refused = [nowhere finish];
  [second close];
  MVCheck(@"recorder: a place it cannot write says so", refused[@"why"] != nil, refused.description);
}

static void checkWords(void) {
  MVCheck(@"words: a word of the table", [MVInTurkish(@"Live") isEqual:@"Canlı"], nil);
  MVCheck(@"words: what the table has not got stands as it came", [MVInTurkish(@"iPhone 17 Pro") isEqual:@"iPhone 17 Pro"], nil);
  MVCheck(@"words: what changes keeps its place, in Turkish order", [MVInTurkish(@"Steady at 60 fps for 30 s") isEqual:@"30 saniyedir 60 fps'de sabit"], MVInTurkish(@"Steady at 60 fps for 30 s"));
  MVCheck(@"words: what a word holds is said in its turn", [MVInTurkish(@"Measuring launch 3 of 6") isEqual:@"Açılış ölçülüyor: 3/6"], MVInTurkish(@"Measuring launch 3 of 6"));
  MVCheck(@"words: what is joined up is said a part at a time", [MVInTurkish(@"Live · 60 fps") isEqual:@"Canlı · 60 fps"] && [MVInTurkish(@"median of 5, stream running") isEqual:@"5 ölçümün ortancası, yayın açık"], MVInTurkish(@"median of 5, stream running"));
  MVCheck(@"words: a number and its unit in a line of Results", [MVInTurkish(@"Scroll  4% jank") isEqual:@"Kaydırma  %4 takılma"], MVInTurkish(@"Scroll  4% jank"));
  MVCheck(@"words: a percent sign in a row stays one", [MVInTurkish(@"72% jank, 3 frozen") isEqual:@"%72 takılma, 3 donma"], MVInTurkish(@"72% jank, 3 frozen"));
}

/// This Mac's pasteboard is a person's: what a window kept behind copies stays on a board of its own.
static void checkBoard(void) {
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".png"]];
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1 pixelsHigh:1 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:file atomically:NO];
  NSInteger before = NSPasteboard.generalPasteboard.changeCount;
  MVPlaceBehind(YES);
  [MVPlaceBoard() clearContents];
  MVCopyImage(file);
  [NSFileManager.defaultManager removeItemAtPath:file error:NULL];
  MVCheck(@"copy: a picture from a window kept behind leaves a person's pasteboard alone", NSPasteboard.generalPasteboard.changeCount == before, nil);
  MVCheck(@"copy: and it stands on the window's own board", [MVPlaceBoard() canReadObjectForClasses:@[NSImage.class] options:nil], nil);
}

void MVCheckKeyboard(void) {
  checkWords();
  checkBoard();
  MVCheck(@"keyboard: a window comes up without it", MVShowOf(NO, NO) == MVShowFront, nil);
  MVCheck(@"keyboard: only --focus takes it", MVShowOf(YES, NO) == MVShowFocused, nil);
  MVCheck(@"keyboard: a window kept behind comes forward for nothing", MVShowOf(YES, YES) == MVShowBehind && MVShowOf(NO, YES) == MVShowBehind, nil);
  MVView *view = [MVView new];
  view.inputOn = YES;
  MVCheck(@"input: none until a person's click, where a window starts so", !view.takesPointer && !view.takesKeys, nil);
  view.armed = YES;
  MVCheck(@"input: a pointer once armed", view.takesPointer, nil);
  MVCheck(@"input: no key reaches a device from a window that is not key", !view.takesKeys, nil);
  MVOffscreenWindow *window = [[MVOffscreenWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 200) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  window.poses = YES;
  MVView *held = [[MVView alloc] initWithFrame:NSMakeRect(0, 0, 200, 200)];
  held.inputOn = YES;
  held.armed = YES;
  window.contentView = held;
  MVCheck(@"keyboard: armed in a key window, it hears nothing until a person clicks there", window.isKeyWindow && !held.takesKeys, nil);
  [held insertText:@"caught" replacementRange:NSMakeRange(NSNotFound, 0)];
  NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:NSEventModifierFlagCommand timestamp:0 windowNumber:window.windowNumber context:nil characters:@"v" charactersIgnoringModifiers:@"v" isARepeat:NO keyCode:9];
  MVCheck(@"keyboard: a shortcut does nothing to a device from a window no person clicked", !MVShortcutMayAct(key, window), nil);
  [window sendEvent:[NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSMakePoint(50, 50) modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1]];
  [window sendEvent:[NSEvent mouseEventWithType:NSEventTypeLeftMouseUp location:NSMakePoint(50, 50) modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:0]];
  MVCheck(@"keyboard: a person's click gives it the keys, and a shortcut counts", held.takesKeys && MVShortcutMayAct(key, window), nil);
  [window resignKeyWindow];
  MVCheck(@"keyboard: losing the keyboard takes them back: a click counts until then", !held.takesKeys && !MVShortcutMayAct(key, window), nil);
  [window close];
}
