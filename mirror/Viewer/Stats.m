// Frames counted over each second, for `stats`, and what the process itself costs.
#import "Viewer.h"
#import <libproc.h>
#import <mach/mach.h>
#import <os/lock.h>
#import <sys/resource.h>

// more than a second of frames at any rate a screen has: a second's percentiles stay cheap
enum { kSamples = 512 };

typedef struct {
  double values[kSamples];
  int count;
} Samples;

static void add(Samples *s, double v) {
  if (s->count < kSamples) s->values[s->count++] = v;
}

static int ascending(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return x < y ? -1 : x > y;
}

static NSNumber *percentile(Samples *s, double p) {
  if (!s->count) return @(-1);
  qsort(s->values, s->count, sizeof(double), ascending);
  int at = (int)(s->count * p);
  return @(round(s->values[at < s->count ? at : s->count - 1] * 10) / 10);
}

double MVNowMs(void) { return clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1e6; }

static double cpuSeconds(void) {
  struct rusage u;
  getrusage(RUSAGE_SELF, &u);
  return u.ru_utime.tv_sec + u.ru_utime.tv_usec / 1e6 + u.ru_stime.tv_sec + u.ru_stime.tv_usec / 1e6;
}

static double residentMb(void) {
  mach_task_basic_info_data_t info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) return -1;
  return round(info.resident_size / 1048576.0 * 10) / 10;
}

static int openDescriptors(void) {
  int bytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
  return bytes > 0 ? bytes / (int)PROC_PIDLISTFD_SIZE : -1;
}

@implementation MVStats {
  os_unfair_lock _lock;
  uint64_t _arrived, _decoded, _shown, _dropped, _bytes;
  Samples _capture, _decode, _gap;
  double _lastShown, _markAt, _since, _cpuAt, _quietBytes;
  BOOL _markBigger;
}

- (instancetype)init {
  if ((self = [super init])) {
    _since = MVNowMs();
    _cpuAt = cpuSeconds();
    _source = @"";
    _mode = @"";
    _decoder = @"";
    _layer = @"";
  }
  return self;
}

- (void)arrived:(size_t)bytes captureMs:(double)ms {
  double now = MVNowMs(), markedAt = 0;
  static const double kWellOverBytes = 3000;
  os_unfair_lock_lock(&_lock);
  _arrived++;
  _bytes += bytes;
  if (ms >= 0) add(&_capture, ms);
  if (_markAt > 0) {
    if (!_markBigger || bytes > MAX(_quietBytes * 2, _quietBytes + kWellOverBytes)) {
      markedAt = _markAt;
      _markAt = 0;
    }
  } else {
    _quietBytes = _quietBytes > 0 ? _quietBytes * 0.9 + bytes * 0.1 : bytes;
  }
  os_unfair_lock_unlock(&_lock);
  if (markedAt > 0) MVEmit(@{@"op": @"marked", @"ms": @(round((now - markedAt) * 10) / 10)});
}

- (void)decodedMs:(double)ms {
  os_unfair_lock_lock(&_lock);
  _decoded++;
  add(&_decode, ms);
  os_unfair_lock_unlock(&_lock);
}

- (void)shown {
  double now = MVNowMs();
  os_unfair_lock_lock(&_lock);
  _shown++;
  if (_lastShown > 0) add(&_gap, now - _lastShown);
  _lastShown = now;
  os_unfair_lock_unlock(&_lock);
}

- (void)dropped:(int)count {
  os_unfair_lock_lock(&_lock);
  _dropped += count;
  os_unfair_lock_unlock(&_lock);
}

- (void)mark:(BOOL)bigger {
  os_unfair_lock_lock(&_lock);
  _markAt = MVNowMs();
  _markBigger = bigger;
  os_unfair_lock_unlock(&_lock);
}

- (void)reset {
  [self report];
  os_unfair_lock_lock(&_lock);
  _lastShown = 0;
  _markAt = 0;
  os_unfair_lock_unlock(&_lock);
}

- (NSDictionary *)report {
  double now = MVNowMs(), cpu = cpuSeconds();
  os_unfair_lock_lock(&_lock);
  double seconds = (now - _since) / 1000;
  CGSize size = _size;
  NSDictionary *out = @{
    @"op": @"stats",
    @"arrived": @(_arrived),
    @"decoded": @(_decoded),
    @"shown": @(_shown),
    @"dropped": @(_dropped),
    @"mbps": @(seconds > 0 ? round(_bytes * 8 / seconds / 1e4) / 100 : 0),
    @"captureP50": percentile(&_capture, 0.5),
    @"captureP95": percentile(&_capture, 0.95),
    @"decodeP50": percentile(&_decode, 0.5),
    @"decodeP95": percentile(&_decode, 0.95),
    @"gapP50": percentile(&_gap, 0.5),
    @"gapP95": percentile(&_gap, 0.95),
    @"w": @(size.width),
    @"h": @(size.height),
    @"cpu": @(seconds > 0 ? round((cpu - _cpuAt) / seconds * 1000) / 10 : 0),
  };
  _arrived = _decoded = _shown = _dropped = _bytes = 0;
  _capture.count = _decode.count = _gap.count = 0;
  _since = now;
  _cpuAt = cpu;
  os_unfair_lock_unlock(&_lock);
  NSMutableDictionary *full = [out mutableCopy];
  full[@"source"] = self.source;
  full[@"mode"] = self.mode;
  full[@"decoder"] = self.decoder;
  full[@"layer"] = self.layer;
  full[@"rssMb"] = @(residentMb());
  full[@"fds"] = @(openDescriptors());
  [full addEntriesFromDictionary:self.counters ?: @{}];
  return full;
}

@end
