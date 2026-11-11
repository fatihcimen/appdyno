// What a window shows of its device's numbers: the readings, a measure under way and its result, the picture's rate.
#import "WindowParts.h"

@implementation MVWindow (Readings)

- (void)showPerf:(NSDictionary *)message {
  if (_hudding) [_hud show:message];
  [_inspector.perf show:message];
}

- (void)showMeasure:(NSDictionary *)message {
  if (!self.inspecting) [self showPane:MVPanePerf];
  if (![message[@"op"] isEqual:@"measured"]) {
    [_inspector.perf showMeasuring:message[@"line"] ?: @""];
    [self sayMeasuring:message[@"line"] ?: @""];
    return;
  }
  [_inspector.perf showMeasured:message];
  [self sayMeasuring:nil];
}

- (void)showStats:(NSDictionary *)stats {
  [_hud setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector.perf setPictureRate:[stats[@"shown"] doubleValue]];
  [_inspector showStats:stats];
  if (_line.rate == [stats[@"shown"] doubleValue]) return;
  _line.rate = [stats[@"shown"] doubleValue];
  [self showState];
}

/// The capsule's words for what a measure says it is at, and how far that is where it counts: `scroll round 3 of 5`.
- (void)sayMeasuring:(nullable NSString *)line {
  NSRegularExpression *count = [NSRegularExpression regularExpressionWithPattern:@"(\\d+) of (\\d+)" options:0 error:NULL];
  NSTextCheckingResult *found = line ? [count firstMatchInString:line options:0 range:NSMakeRange(0, line.length)] : nil;
  _line.measuring = found ? [@"Measuring " stringByAppendingString:line] : line.length ? line
                                                                                       : nil;
  _line.progress = found ? [line substringWithRange:[found rangeAtIndex:1]].doubleValue / [line substringWithRange:[found rangeAtIndex:2]].doubleValue : 0;
  [self showState];
}

@end
