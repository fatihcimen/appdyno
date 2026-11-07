// Tiles of a frame are looked for along each axis in the frame a step of time later. Tiles that moved the same way and
// touch are a region, and the middle of their shifts at each step is how it moved: its steady speed, and what broke it.
#import "Motion.h"

enum {
  MVTile = 24,
  /// Half a screen would find a repeat of a letter: this is 650 points a second, or a jump of 100, on a phone.
  MVReach = 64,
  MVMaxSteps = 256,
  MVNoShift = INT16_MAX,
  MVStill = 0,
};
/// Long enough for a slow text to move a whole sample: frame to frame it would read as stops and starts.
static const double MVStepMs = 100;
/// A tile's mean difference, by the sample, that is a change and not a stream's noise.
static const int MVChanged = 4;
/// What is left of a change at the best shift must be this much under no shift at all.
static const double MVFound = 0.35;
static const int MVFlat = 24;
/** The least a step's shift must differ by to be a jump, in samples: about 7 points on a phone. */
static const double MVJump = 6;
/// Of its steps, the share a tile must have moved or changed in to count.
static const double MVOften = 0.2;
/// Of the tiles, the share changing at once that is a video or a game; and of the steps, how often.
static const double MVBusyTiles = 0.5;
static const double MVBusySteps = 0.3;
static const double MVNoisyArea = 0.3;

static long difference(const uint8_t *a, const uint8_t *b, int stride) {
  long sum = 0;
  for (int y = 0; y < MVTile; y++, a += stride, b += stride)
    for (int x = 0; x < MVTile; x++) sum += abs(a[x] - b[x]);
  return sum;
}

static BOOL flat(const uint8_t *a, int stride) {
  int low = 255, high = 0;
  for (int y = 0; y < MVTile; y++, a += stride)
    for (int x = 0; x < MVTile; x++) {
      low = MIN(low, a[x]);
      high = MAX(high, a[x]);
    }
  return high - low < MVFlat;
}

static int compareInts(const void *a, const void *b) {
  return *(const int *)a - *(const int *)b;
}

@implementation MVMotion {
  int _w, _h, _cols, _rows, _steps, _frames, _busy;
  NSMutableData *_last;
  double _firstMs, _lastMs;
  double _dt[MVMaxSteps], _at[MVMaxSteps];
  /// By step and tile: a shift along x, along y, or MVNoShift where it changed and could not be followed.
  int16_t *_dx, *_dy;
}

- (instancetype)initWithWidth:(int)width height:(int)height {
  if ((self = [super init])) {
    _w = width;
    _h = height;
    _cols = width / MVTile;
    _rows = height / MVTile;
    _dx = calloc(MVMaxSteps * _cols * _rows, sizeof(int16_t));
    _dy = calloc(MVMaxSteps * _cols * _rows, sizeof(int16_t));
  }
  return self;
}

- (void)dealloc {
  free(_dx);
  free(_dy);
}

- (void)addGray:(const uint8_t *)gray atMs:(double)ms {
  _frames++;
  if (!_last) {
    _last = [NSMutableData dataWithBytes:gray length:_w * _h];
    _firstMs = _lastMs = ms;
    return;
  }
  if (ms - _lastMs < MVStepMs || _steps >= MVMaxSteps) return;
  [self stepFrom:_last.bytes to:gray dt:ms - _lastMs at:ms - _firstMs];
  memcpy(_last.mutableBytes, gray, _w * _h);
  _lastMs = ms;
}

- (void)stepFrom:(const uint8_t *)before to:(const uint8_t *)after dt:(double)dt at:(double)at {
  int16_t *dx = _dx + _steps * _cols * _rows, *dy = _dy + _steps * _cols * _rows;
  int changed = 0;
  for (int r = 0; r < _rows; r++)
    for (int c = 0; c < _cols; c++) {
      int t = r * _cols + c, x0 = c * MVTile, y0 = r * MVTile;
      const uint8_t *tile = before + y0 * _w + x0;
      long still = difference(tile, after + y0 * _w + x0, _w);
      if (still < MVChanged * MVTile * MVTile) continue;
      changed++;
      dx[t] = dy[t] = MVNoShift;
      if (flat(tile, _w)) continue;
      long best = (long)(still * MVFound);
      // nearest first: of two shifts as good, the far one is a repeat of a letter
      for (int reach = 1; reach <= MVReach; reach++)
        for (int s = -reach; s <= reach; s += 2 * reach) {
          if (x0 + s >= 0 && x0 + s + MVTile <= _w) {
            long d = difference(tile, after + y0 * _w + x0 + s, _w);
            if (d < best) best = d, dx[t] = s, dy[t] = MVStill;
          }
          if (y0 + s >= 0 && y0 + s + MVTile <= _h) {
            long d = difference(tile, after + (y0 + s) * _w + x0, _w);
            if (d < best) best = d, dy[t] = s, dx[t] = MVStill;
          }
        }
    }
  if (changed > _cols * _rows * MVBusyTiles) _busy++;
  _dt[_steps] = dt;
  _at[_steps] = at;
  _steps++;
}

- (NSDictionary *)summary {
  NSMutableArray *regions = [NSMutableArray array];
  int tiles = _cols * _rows, area = 0;
  int *along = calloc(tiles, sizeof(int)), *across = calloc(tiles, sizeof(int)), *lost = calloc(tiles, sizeof(int));
  for (int k = 0; k < _steps; k++)
    for (int t = 0; t < tiles; t++) {
      int16_t x = _dx[k * tiles + t], y = _dy[k * tiles + t];
      if (x == MVNoShift) lost[t]++;
      else if (x) along[t]++;
      else if (y) across[t]++;
    }
  int often = MAX(2, (int)ceil(_steps * MVOften));
  // 1 along x, 2 along y, 3 changes with no direction
  char *kind = calloc(tiles, 1);
  for (int t = 0; t < tiles; t++)
    kind[t] = along[t] >= often && along[t] >= across[t] ? 1 : across[t] >= often ? 2 : lost[t] >= often ? 3 : 0;
  // what leaves the frame has nowhere to be found: a tile that lost its way beside a moving one is the same thing
  for (int pass = 0; pass < _cols + _rows; pass++)
    for (int t = 0; t < tiles; t++) {
      if (kind[t] != 3) continue;
      int near[4] = {t % _cols ? t - 1 : -1, (t + 1) % _cols ? t + 1 : -1, t >= _cols ? t - _cols : -1, t + _cols < tiles ? t + _cols : -1};
      for (int i = 0; i < 4; i++)
        if (near[i] >= 0 && (kind[near[i]] == 1 || kind[near[i]] == 2)) kind[t] = kind[near[i]];
    }
  int *stack = malloc(tiles * sizeof(int));
  char *seen = calloc(tiles, 1);
  for (int first = 0; first < tiles; first++) {
    if (!kind[first] || seen[first]) continue;
    int top = 0, count = 0, left = _cols, right = 0, up = _rows, down = 0, *members = malloc(tiles * sizeof(int));
    stack[top++] = first;
    seen[first] = 1;
    while (top) {
      int t = stack[--top], c = t % _cols, r = t / _cols;
      members[count++] = t;
      left = MIN(left, c), right = MAX(right, c), up = MIN(up, r), down = MAX(down, r);
      int near[4] = {c > 0 ? t - 1 : -1, c + 1 < _cols ? t + 1 : -1, r > 0 ? t - _cols : -1, r + 1 < _rows ? t + _cols : -1};
      for (int i = 0; i < 4; i++)
        if (near[i] >= 0 && !seen[near[i]] && kind[near[i]] == kind[first]) seen[near[i]] = 1, stack[top++] = near[i];
    }
    NSMutableDictionary *region = [@{
      @"kind": kind[first] == 3 ? @"changes" : @"moves",
      @"x": @((double)left * MVTile / _w),
      @"y": @((double)up * MVTile / _h),
      @"w": @((double)(right - left + 1) * MVTile / _w),
      @"h": @((double)(down - up + 1) * MVTile / _h),
    } mutableCopy];
    if (kind[first] == 3) area += count;
    else [self follow:members count:count axis:kind[first] into:region];
    free(members);
    [regions addObject:region];
  }
  free(along), free(across), free(lost), free(kind), free(stack), free(seen);
  return @{
    @"frames": @(_frames),
    @"ms": @(_lastMs - _firstMs),
    @"noisy": _steps && (_busy > _steps * MVBusySteps || area > tiles * MVNoisyArea) ? @YES : @NO,
    @"regions": regions,
  };
}

/// The middle of a region's shifts at each step is its movement; the middle of those is what it does when nothing is wrong.
- (void)follow:(const int *)members count:(int)count axis:(int)axis into:(NSMutableDictionary *)region {
  const int16_t *field = axis == 1 ? _dx : _dy;
  int series[MVMaxSteps], moving[MVMaxSteps], *shifts = malloc(count * sizeof(int)), used = 0;
  BOOL heard[MVMaxSteps];
  for (int k = 0; k < _steps; k++) {
    int n = 0;
    for (int i = 0; i < count; i++) {
      int16_t s = field[k * _cols * _rows + members[i]];
      if (s != MVNoShift && s) shifts[n++] = s;
    }
    if (n) qsort(shifts, n, sizeof(int), compareInts);
    series[k] = n ? shifts[n / 2] : 0;
    heard[k] = n > 0;
    // samples a second: a step is as long as the frames made it
    if (n) moving[used++] = (int)(series[k] * 1000 / _dt[k]);
  }
  free(shifts);
  if (!used) return;
  qsort(moving, used, sizeof(int), compareInts);
  double usual = moving[used / 2];
  double total = 0, time = 0, size = axis == 1 ? _w : _h;
  NSMutableArray *events = [NSMutableArray array];
  NSString *lastKind = nil;
  int last = 0;
  for (int k = 0; k < _steps; k++) last = heard[k] ? k : last;
  for (int k = 0; k < _steps; k++) {
    total += series[k];
    time += _dt[k];
    double s = series[k], expected = usual * _dt[k] / 1000;
    BOOL back = heard[k] && s * usual < 0;
    BOOL jump = heard[k] && !back && fabs(s - expected) >= MAX(MVJump, fabs(expected));
    BOOL stop = !heard[k] && k > 0 && k < last;
    NSString *what = back ? @"back" : jump ? @"jump" : stop ? @"stop" : nil;
    if (what && ![what isEqual:lastKind])
      [events addObject:@{@"kind": what, @"at": @(_at[k]), @"by": @((s - (back ? 0 : expected)) / size)}];
    lastKind = what;
  }
  region[@"axis"] = axis == 1 ? @"x" : @"y";
  region[@"sign"] = @(total < 0 ? -1 : 1);
  region[@"speed"] = @(fabs(total) / size / (time / 1000));
  region[@"events"] = events;
}

@end
