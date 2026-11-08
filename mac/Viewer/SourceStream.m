// The agent's stream on its own connection: through the adb server to the agent's socket, with its token,
// then frames straight to the decoder. Nothing passes through the parent, so a reconnect needs no new viewer.
#import "Viewer.h"
#import <arpa/inet.h>
#import <fcntl.h>
#import <netinet/in.h>
#import <netinet/tcp.h>
#import <poll.h>
#import <sys/socket.h>

enum {
  kFrameJson = 0,
  kFrameVideo = 2,
  kVideoHeader = 20,
  kMaxFrame = 64 * 1024 * 1024,
  kClockPings = 8,
  kClockEverySeconds = 10,
  // pings answer in this time, whatever the screen does: past it the far end is gone
  kSilentSeconds = 25,
  kPipePollMs = 200,
};

static BOOL readAll(int fd, void *into, size_t length) {
  uint8_t *p = into;
  while (length) {
    ssize_t got = read(fd, p, length);
    if (got <= 0) {
      if (got < 0 && errno == EINTR) continue;
      return NO;
    }
    p += got;
    length -= got;
  }
  return YES;
}

static BOOL writeAll(int fd, const void *from, size_t length) {
  const uint8_t *p = from;
  while (length) {
    ssize_t put = write(fd, p, length);
    if (put <= 0) {
      if (put < 0 && errno == EINTR) continue;
      return NO;
    }
    p += put;
    length -= put;
  }
  return YES;
}

static uint64_t big64(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
  return v;
}

/// One request to the adb server: four hex digits of length, the text, OKAY or FAIL. What it refused with.
static NSString *askAdb(int fd, NSString *request) {
  NSData *body = [request dataUsingEncoding:NSUTF8StringEncoding];
  char head[5];
  snprintf(head, sizeof head, "%04x", (unsigned)body.length);
  if (!writeAll(fd, head, 4) || !writeAll(fd, body.bytes, body.length)) return @"adb went away";
  char status[4];
  if (!readAll(fd, status, 4)) return @"adb went away";
  if (memcmp(status, "OKAY", 4) == 0) return nil;
  char length[5] = {0};
  if (!readAll(fd, length, 4)) return @"adb refused";
  size_t n = strtoul(length, NULL, 16);
  if (n > 1024) n = 1024;
  NSMutableData *text = [NSMutableData dataWithLength:n];
  if (n && !readAll(fd, text.mutableBytes, n)) return @"adb refused";
  return [[NSString alloc] initWithData:text encoding:NSUTF8StringEncoding] ?: @"adb refused";
}

@implementation MVSourceStream {
  NSDictionary *_options;
  __weak id<MVSink> _sink;
  MVDecoder *_decoder;
  int _fd;
  NSLock *_writeLock;
  NSThread *_thread;
  dispatch_source_t _clock;
  dispatch_semaphore_t _ended;
  double _offsetMs, _bestRtt;
  BOOL _haveOffset;
  NSMutableDictionary<NSNumber *, NSNumber *> *_pings;
  int _nextId;
  BOOL _stopping;
  BOOL _hidden;
  BOOL _pipe;
}

- (instancetype)initWithOptions:(NSDictionary *)options sink:(id<MVSink>)sink {
  if ((self = [super init])) {
    _options = options;
    _sink = sink;
    _fd = -1;
    _writeLock = [NSLock new];
    _ended = dispatch_semaphore_create(0);
    _pings = [NSMutableDictionary dictionary];
    _nextId = 1;
    _decoder = [[MVDecoder alloc] initWithSink:sink from:self];
    _decoder.hevc = [options[@"codec"] isEqual:@"hevc"];
    _pipe = [options[@"kind"] isEqual:@"pipe"];
  }
  return self;
}

- (void)start {
  _thread = [[NSThread alloc] initWithBlock:^{
    if (self->_pipe) {
      [self servePipe];
    } else {
      int fd = [self connectToAdb];
      if (fd >= 0) [self serve:fd];
    }
    dispatch_semaphore_signal(self->_ended);
  }];
  _thread.qualityOfService = NSQualityOfServiceUserInteractive;
  [_thread start];
}

- (void)runOnDescriptor:(int)fd {
  _thread = [[NSThread alloc] initWithBlock:^{
    [self serve:fd];
    dispatch_semaphore_signal(self->_ended);
  }];
  _thread.qualityOfService = NSQualityOfServiceUserInteractive;
  [_thread start];
}

- (void)stop {
  @synchronized(self) {
    _stopping = YES;
    // ends a read blocked on it, and the agent sees the end
    if (_fd >= 0) shutdown(_fd, SHUT_RDWR);
  }
  if (_thread) dispatch_semaphore_wait(_ended, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
  [self finishRecording];
  [_decoder close];
}

- (void)startRecording:(NSString *)file {
  MVRecorder *recorder = [[MVRecorder alloc] initWithFile:file];
  _decoder.recorder = recorder;
  [_decoder awaitKey];
}

- (NSDictionary *)finishRecording {
  MVRecorder *recorder = _decoder.recorder;
  _decoder.recorder = nil;
  return [recorder finish];
}

- (void)setHidden:(BOOL)hidden {
  BOOL back = _hidden && !hidden;
  _hidden = hidden;
  if (back) [_decoder awaitKey];
}

- (void)lost:(NSString *)why fatal:(BOOL)fatal {
  @synchronized(self) {
    if (_stopping) return;
  }
  id<MVSink> sink = _sink;
  [sink source:self lost:why fatal:fatal];
}

- (int)connectToAdb {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  int on = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &on, sizeof on);
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
  struct sockaddr_in to = {.sin_family = AF_INET, .sin_port = htons([_options[@"adbPort"] intValue] ?: 5037), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
  if (connect(fd, (struct sockaddr *)&to, sizeof to) != 0) {
    close(fd);
    [self lost:@"adb server not reachable" fatal:NO];
    return -1;
  }
  NSString *failed = askAdb(fd, [NSString stringWithFormat:@"host:transport:%@", _options[@"serial"]])
                         ?: askAdb(fd, [NSString stringWithFormat:@"localabstract:%@", _options[@"socket"]]);
  if (failed) {
    close(fd);
    [self lost:failed fatal:NO];
    return -1;
  }
  return fd;
}

/// Held open both ways: what writes may come and go, and only a stop or its own last word ends this.
- (void)servePipe {
  int fd = open([_options[@"file"] fileSystemRepresentation], O_RDWR | O_NONBLOCK);
  if (fd < 0) {
    [self lost:[NSString stringWithFormat:@"the picture's pipe: %s", strerror(errno)] fatal:NO];
    return;
  }
  NSString *why = [self readFrames:fd];
  close(fd);
  if (why) [self lost:why fatal:NO];
}

/// All of it, or NO at a stop or an error. A stop only ever comes between reads of a pipe that may stay silent.
- (BOOL)readPipe:(int)fd into:(uint8_t *)into length:(size_t)length {
  while (length) {
    @synchronized(self) {
      if (_stopping) return NO;
    }
    struct pollfd wanted = {.fd = fd, .events = POLLIN};
    if (poll(&wanted, 1, kPipePollMs) <= 0) continue;
    ssize_t got = read(fd, into, length);
    if (got < 0 && (errno == EAGAIN || errno == EINTR)) continue;
    if (got <= 0) return NO;
    into += got;
    length -= got;
  }
  return YES;
}

- (BOOL)read:(int)fd into:(uint8_t *)into length:(size_t)length {
  return _pipe ? [self readPipe:fd into:into length:length] : readAll(fd, into, length);
}

- (BOOL)sendMethod:(NSString *)method params:(NSDictionary *)params id:(int)requestId {
  NSData *body = [NSJSONSerialization dataWithJSONObject:@{@"jsonrpc": @"2.0", @"id": @(requestId), @"method": method, @"params": params} options:0 error:NULL];
  uint8_t head[5];
  uint32_t big = htonl((uint32_t)body.length);
  memcpy(head, &big, 4);
  head[4] = kFrameJson;
  [_writeLock lock];
  BOOL ok = writeAll(_fd, head, 5) && writeAll(_fd, body.bytes, body.length);
  [_writeLock unlock];
  return ok;
}

- (void)ping {
  int requestId;
  @synchronized(self) {
    if (_fd < 0) return;
    requestId = _nextId++;
    _pings[@(requestId)] = @(MVNowMs());
  }
  [self sendMethod:@"stream.clock" params:@{} id:requestId];
}

- (void)serve:(int)fd {
  @synchronized(self) {
    _fd = fd;
    if (_stopping) shutdown(fd, SHUT_RDWR);
  }
  struct timeval silent = {.tv_sec = kSilentSeconds};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &silent, sizeof silent);
  [self sendMethod:@"hello" params:@{@"token": _options[@"token"] ?: @"", @"protocol": @2} id:_nextId++];
  for (int i = 0; i < kClockPings; i++) [self ping];
  NSMutableDictionary *start = [@{@"codec": _options[@"codec"] ?: @"h264"} mutableCopy];
  [start addEntriesFromDictionary:_options[@"start"] ?: @{}];
  [self sendMethod:@"stream.start" params:start id:_nextId++];
  _clock = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
  dispatch_source_set_timer(_clock, dispatch_time(DISPATCH_TIME_NOW, kClockEverySeconds * NSEC_PER_SEC), kClockEverySeconds * NSEC_PER_SEC, NSEC_PER_SEC);
  __weak MVSourceStream *weak = self;
  dispatch_source_set_event_handler(_clock, ^{
    [weak ping];
  });
  dispatch_resume(_clock);
  NSString *why = [self readFrames:fd];
  dispatch_source_cancel(_clock);
  @synchronized(self) {
    _fd = -1;
    close(fd);
  }
  if (why) [self lost:why fatal:NO];
}

/// Runs until the connection ends; why it did, or nil when the sink was told already.
- (NSString *)readFrames:(int)fd {
  size_t capacity = 1 << 20;
  uint8_t *buffer = malloc(capacity);
  NSString *why = nil;
  BOOL refused = NO;
  id<MVSink> sink = _sink;
  while (!why && !refused) {
    // this thread never returns to a run loop: what a frame leaves behind goes with the frame
    @autoreleasepool {
      uint8_t head[5];
      if (![self read:fd into:head length:5]) {
        why = @"the stream ended";
        break;
      }
      uint32_t length = ntohl(*(uint32_t *)head);
      if (length > kMaxFrame) {
        why = @"a frame over the limit: the stream is broken";
        break;
      }
      if (length > capacity) {
        uint8_t *grown = realloc(buffer, length);
        if (!grown) {
          why = @"out of memory";
          break;
        }
        buffer = grown;
        capacity = length;
      }
      if (![self read:fd into:buffer length:length]) {
        why = @"the stream ended";
        break;
      }
      if (head[4] == kFrameJson) {
        refused = [self onJson:buffer length:length];
      } else if (head[4] == kFrameVideo && length >= kVideoHeader) {
        double capture = _haveOffset ? MVNowMs() - (big64(buffer) / 1000.0 - _offsetMs) : -1;
        [sink.stats arrived:length - kVideoHeader captureMs:capture];
        if (_hidden && !_decoder.recorder) [sink.stats dropped:1];
        else {
          _decoder.capturedMs = big64(buffer) / 1000.0;
          [_decoder decode:buffer + kVideoHeader length:length - kVideoHeader];
        }
      }
    }
  }
  free(buffer);
  return why;
}

/// A message of the agent; YES when it ended the stream, with the sink told why.
- (BOOL)onJson:(const uint8_t *)data length:(size_t)length {
  NSDictionary *m = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytesNoCopy:(void *)data length:length freeWhenDone:NO] options:0 error:NULL];
  if (![m isKindOfClass:NSDictionary.class]) return NO;
  NSNumber *requestId = m[@"id"];
  NSNumber *sentAt = nil;
  if (requestId) @synchronized(self) {
      sentAt = _pings[requestId];
      [_pings removeObjectForKey:requestId];
    }
  id<MVSink> sink = _sink;
  if (sentAt) {
    double now = MVNowMs(), rtt = now - sentAt.doubleValue;
    // the offset of the shortest round trip is the truest; it drifts, so a later one is taken if near as good
    if (!_haveOffset || rtt <= _bestRtt * 1.5) {
      _offsetMs = [m[@"result"][@"now"] doubleValue] / 1e6 - (now + sentAt.doubleValue) / 2;
      _bestRtt = _haveOffset ? MIN(_bestRtt, rtt) : rtt;
      _haveOffset = YES;
    }
    return NO;
  }
  NSDictionary *error = m[@"error"];
  if (error) {
    [sink source:self lost:[NSString stringWithFormat:@"%@", error[@"message"]] fatal:YES];
    return YES;
  }
  if ([m[@"method"] isEqual:@"stream.info"]) {
    NSDictionary *info = m[@"params"];
    _decoder.hevc = [info[@"codec"] isEqual:@"hevc"];
    if ([info[@"crop"] boolValue]) _decoder.crop = CGSizeMake([info[@"w"] doubleValue], [info[@"h"] doubleValue]);
    sink.stats.mode = [NSString stringWithFormat:@"%@", info[@"mode"] ?: @""];
    [sink source:self size:CGSizeMake([info[@"w"] doubleValue], [info[@"h"] doubleValue]) codec:_decoder.hevc ? @"hevc" : @"h264"];
  }
  if ([m[@"method"] isEqual:@"stream.counters"]) sink.stats.counters = m[@"params"];
  if ([m[@"method"] isEqual:@"stream.turns"]) [sink source:self turns:[m[@"params"][@"turns"] intValue] & 3];
  if ([m[@"method"] isEqual:@"stream.end"]) {
    [sink source:self lost:[NSString stringWithFormat:@"%@", m[@"params"][@"why"]] fatal:YES];
    return YES;
  }
  return NO;
}

@end
