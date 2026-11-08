// An emulator's screen: the emulator writes RGBA into a shared file, the parent says so with a `tick`, and
// each tick is copied into an IOSurface. The emulator's own notes warn of tearing, accepted for a copy. A
// guest that rotates draws sideways in a frame of the same shape, so `turns` says how to stand it up.
#import "Viewer.h"
#import <Accelerate/Accelerate.h>
#import <os/lock.h>
#import <sys/mman.h>
#import <sys/stat.h>

// the one on screen, the one being written, and one to spare: a layer may hold on to the last a moment longer
enum { kSurfaces = 3,
       kMaxSide = 16384 };

static IOSurfaceRef newSurface(size_t w, size_t h) {
  NSDictionary *properties = @{
    (id)kIOSurfaceWidth: @(w),
    (id)kIOSurfaceHeight: @(h),
    (id)kIOSurfaceBytesPerElement: @4,
    (id)kIOSurfacePixelFormat: @(kCVPixelFormatType_32BGRA),
  };
  return IOSurfaceCreate((__bridge CFDictionaryRef)properties);
}

@implementation MVSourcePixels {
  NSDictionary *_options;
  __weak id<MVSink> _sink;
  dispatch_queue_t _queue;
  const uint8_t *_map;
  size_t _mapped;
  id _surfaces[kSurfaces];
  int _next;
  os_unfair_lock _lock;
  size_t _pendingW, _pendingH;
  int _pendingTurns;
  BOOL _busy, _hidden, _stopped;
  size_t _lastW, _lastH;
  int _lastTurns;
}

- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink {
  if ((self = [super init])) {
    _options = options;
    _sink = sink;
    _queue = dispatch_queue_create("appdyno.pixels", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0));
  }
  return self;
}

- (void)start {
  dispatch_async(_queue, ^{
    [self openFile];
  });
}

- (void)lost:(NSString *)why {
  id<MVSink> sink = _sink;
  [sink source:self lost:why fatal:NO];
}

- (void)openFile {
  int fd = open([_options[@"file"] fileSystemRepresentation], O_RDONLY);
  if (fd < 0) return [self lost:@"the pixel file is missing"];
  struct stat info;
  if (fstat(fd, &info) != 0 || info.st_size <= 0) {
    close(fd);
    return [self lost:@"the pixel file is empty"];
  }
  void *map = mmap(NULL, (size_t)info.st_size, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (map == MAP_FAILED) return [self lost:@"the pixel file cannot be mapped"];
  _map = map;
  _mapped = (size_t)info.st_size;
}

- (void)tick:(NSDictionary *)message {
  size_t w = [message[@"w"] unsignedLongValue], h = [message[@"h"] unsignedLongValue];
  id<MVSink> sink = _sink;
  // the frame's bytes crossed nothing to get here: no bit rate to speak of
  [sink.stats arrived:0 captureMs:-1];
  os_unfair_lock_lock(&_lock);
  // only the newest can be shown: a tick that comes during a copy replaces the one before it
  BOOL replaced = _pendingW != 0;
  _pendingW = w;
  _pendingH = h;
  _pendingTurns = [message[@"turns"] intValue] & 3;
  BOOL start = !_busy;
  if (start) _busy = YES;
  os_unfair_lock_unlock(&_lock);
  if (replaced) [sink.stats dropped:1];
  if (start) dispatch_async(_queue, ^{
    [self drain];
  });
}

- (void)drain {
  for (;;) {
    os_unfair_lock_lock(&_lock);
    size_t w = _pendingW, h = _pendingH;
    int turns = _pendingTurns;
    _pendingW = _pendingH = 0;
    if (!w || _stopped) _busy = NO;
    BOOL go = w && !_stopped;
    os_unfair_lock_unlock(&_lock);
    if (!go) return;
    [self copyWidth:w height:h turns:turns];
  }
}

- (void)copyWidth:(size_t)w height:(size_t)h turns:(int)turns {
  if (!_map) return;
  // the sizes come from a message: they are checked against what is mapped before a byte is read
  if (w > kMaxSide || h > kMaxSide || w * h * 4 > _mapped) return [self lost:@"a frame larger than the pixel file"];
  id<MVSink> sink = _sink;
  size_t outW = turns % 2 ? h : w, outH = turns % 2 ? w : h;
  if (w != _lastW || h != _lastH || turns != _lastTurns) {
    BOOL shape = !_lastW || outW != (_lastTurns % 2 ? _lastH : _lastW) || outH != (_lastTurns % 2 ? _lastW : _lastH);
    _lastW = w;
    _lastH = h;
    _lastTurns = turns;
    if (shape) {
      for (int i = 0; i < kSurfaces; i++) _surfaces[i] = nil;
      [sink source:self size:CGSizeMake(outW, outH) codec:@"pixels"];
    }
  }
  if (_hidden) {
    [sink.stats dropped:1];
    return;
  }
  if (!_surfaces[_next]) _surfaces[_next] = (__bridge_transfer id)newSurface(outW, outH);
  IOSurfaceRef surface = (__bridge IOSurfaceRef)_surfaces[_next];
  if (!surface) return [self lost:@"no memory for a surface"];
  double started = MVNowMs();
  IOSurfaceLock(surface, 0, NULL);
  vImage_Buffer from = {(void *)_map, h, w, w * 4};
  vImage_Buffer to = {IOSurfaceGetBaseAddress(surface), outH, outW, IOSurfaceGetBytesPerRow(surface)};
  const uint8_t rgbaToBgra[4] = {2, 1, 0, 3};
  if (turns) {
    const Pixel_8888 black = {0, 0, 0, 255};
    // counterclockwise, which is what a turn of the guest's display takes back
    vImageRotate90_ARGB8888(&from, &to, (uint8_t)turns, black, kvImageNoFlags);
    vImagePermuteChannels_ARGB8888(&to, &to, rgbaToBgra, kvImageNoFlags);
  } else {
    vImagePermuteChannels_ARGB8888(&from, &to, rgbaToBgra, kvImageNoFlags);
  }
  IOSurfaceUnlock(surface, 0, NULL);
  [sink.stats decodedMs:MVNowMs() - started];
  [sink source:self surface:surface];
  _next = (_next + 1) % kSurfaces;
}

- (void)setHidden:(BOOL)hidden {
  dispatch_async(_queue, ^{
    self->_hidden = hidden;
    // nothing to ask of the far end: the file already holds the screen as it is
    if (!hidden && self->_lastW) [self copyWidth:self->_lastW height:self->_lastH turns:self->_lastTurns];
  });
}

- (void)stop {
  os_unfair_lock_lock(&_lock);
  _stopped = YES;
  os_unfair_lock_unlock(&_lock);
  dispatch_sync(_queue, ^{
    if (self->_map) munmap((void *)self->_map, self->_mapped);
    self->_map = NULL;
    for (int i = 0; i < kSurfaces; i++) self->_surfaces[i] = nil;
  });
}

@end
