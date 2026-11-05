// What MVMotion makes of frames made up here: a band of text-like marks that moves as told, over a still background.
#import "Motion.h"
#import "SelfTest.h"

enum { W = 360, H = 780, BandY = 240, BandH = 48 };

/// Marks that do not repeat, as letters: a position along the band.
static uint8_t mark(int x, int y) {
  uint32_t n = ((uint32_t)(x / 7) * 7919u + (uint32_t)(y / 7)) * 2654435761u;
  return (n >> 24) > 120 ? 20 : 235;
}

static void paint(uint8_t *frame, int offset, int clipRight) {
  memset(frame, 255, W * H);
  for (int y = BandY; y < BandY + BandH; y++)
    for (int x = 0; x < clipRight; x++) frame[y * W + x] = mark(x + offset + 100000, y);
}

typedef int (^Offset)(double seconds);

static NSDictionary *watched(Offset offset, int clipRight) {
  MVMotion *motion = [[MVMotion alloc] initWithWidth:W height:H];
  uint8_t *frame = malloc(W * H);
  for (int i = 0; i < 180; i++) {
    double seconds = i / 60.0;
    paint(frame, offset(seconds), clipRight);
    [motion addGray:frame atMs:seconds * 1000];
  }
  free(frame);
  return motion.summary;
}

static NSDictionary *only(NSDictionary *summary) {
  NSArray *moves = [summary[@"regions"] filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"kind == 'moves'"]];
  return moves.count == 1 ? moves[0] : nil;
}

static BOOL hasEvent(NSDictionary *region, NSString *kind) {
  for (NSDictionary *e in region[@"events"])
    if ([e[@"kind"] isEqual:kind]) return YES;
  return NO;
}

void MVTestMotion(void) {
  NSDictionary *smooth = only(watched(^int(double s) { return (int)(s * 120); }, W));
  double speed = [smooth[@"speed"] doubleValue] * W;
  MVCheck(@"motion: a smooth band is one region, moving left at its speed", smooth && [smooth[@"sign"] intValue] < 0 && [smooth[@"axis"] isEqual:@"x"] && fabs(speed - 120) < 12, [NSString stringWithFormat:@"%@", smooth]);
  MVCheck(@"motion: smooth has nothing to report", [smooth[@"events"] count] == 0, [NSString stringWithFormat:@"%@", smooth[@"events"]]);
  MVCheck(@"motion: its place is the band's", fabs([smooth[@"y"] doubleValue] * H - BandY) <= 24 && [smooth[@"h"] doubleValue] * H <= BandH + 48, nil);

  NSDictionary *jumps = only(watched(^int(double s) { return (int)(s * 120) + (s > 1.2 ? 30 : 0); }, W));
  NSDictionary *jump = [jumps[@"events"] firstObject];
  MVCheck(@"motion: a jump is said, and when", hasEvent(jumps, @"jump") && fabs([jump[@"at"] doubleValue] - 1200) < 200, [NSString stringWithFormat:@"%@", jumps[@"events"]]);

  NSDictionary *back = only(watched(^int(double s) { return s > 1 && s < 1.5 ? (int)(120 - (s - 1) * 120) : s >= 1.5 ? (int)(60 + (s - 1.5) * 120) : (int)(s * 120); }, W));
  MVCheck(@"motion: running backwards is said", hasEvent(back, @"back"), [NSString stringWithFormat:@"%@", back[@"events"]]);

  NSDictionary *cut = only(watched(^int(double s) { return (int)(s * 120); }, 216));
  MVCheck(@"motion: a clipped band ends where it is clipped", cut && ([cut[@"x"] doubleValue] + [cut[@"w"] doubleValue]) * W <= 240, [NSString stringWithFormat:@"%@", cut]);

  MVMotion *noise = [[MVMotion alloc] initWithWidth:W height:H];
  uint8_t *frame = malloc(W * H);
  for (int i = 0; i < 60; i++) {
    arc4random_buf(frame, W * H);
    [noise addGray:frame atMs:i * 16.7];
  }
  free(frame);
  MVCheck(@"motion: every tile changing is noise, and says so", [noise.summary[@"noisy"] boolValue], nil);

  MVMotion *still = [[MVMotion alloc] initWithWidth:W height:H];
  uint8_t *quiet = malloc(W * H);
  paint(quiet, 0, W);
  for (int i = 0; i < 60; i++) [still addGray:quiet atMs:i * 16.7];
  free(quiet);
  MVCheck(@"motion: a still screen has no regions", [still.summary[@"regions"] count] == 0, nil);
}
