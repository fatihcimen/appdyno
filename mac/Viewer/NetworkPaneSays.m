// What the Network pane says: what its capture is doing, in its row; what a way does or the device lacks, in the card
// where no request is listed; how fast the app's network is; and at its foot, what the parent answered.
#import "NetworkPane.h"
#import "Place.h"
#import "Words.h"

static const double kGoneSeconds = 4;

/// How slow the probe makes the app's network: the op's word, and its name here.
static NSString *const kSpeeds[][2] = {
    {@"full", @"Full Speed"},
    {@"slow", @"Slow"},
    {@"gsm", @"GSM"},
    {@"gprs", @"GPRS"},
    {@"edge", @"EDGE"},
    {@"umts", @"UMTS"},
    {@"3g", @"3G"},
    {@"hsdpa", @"HSDPA"},
    {@"lte", @"LTE"},
    {@"offline", @"Offline"},
};

enum { kSpeedCount = sizeof kSpeeds / sizeof kSpeeds[0] };

/// Each way by its name, as a person reads it, what a capture by it is called, and what it shows.
static NSString *const kWays[][4] = {
    {@"probe", @"Probe", @"See this app's requests", @"Restarts the app with a probe in it, then lists each request it makes through URLSession: method, address, status, time and size. While it is in, the app's own certificate check (pinning) is not asked."},
    {@"proxy", @"Proxy", @"See what goes through the proxy", @"Lists what goes through the proxy this device already uses, where this tool can read the proxy's list. HTTPS shows only its host unless the proxy decrypts it."},
    {@"bytes", @"Bytes", @"Count what this app sends and receives", @"Counts what the app sends and receives, with no addresses."},
    {@"packets", @"Packets", @"Count this app's packets", @"Counts the app's packets by port when the capture stops, with no addresses."},
};

enum { kWayCount = sizeof kWays / sizeof kWays[0] };

/// What a capture by this way is doing, from a time: what a screen reader is told of the line that shows the time gone.
static NSString *const kCapturing[kWayCount] = {@"Capturing by the probe since %@", @"Capturing through the proxy since %@", @"Counting bytes since %@", @"Counting packets since %@"};

static NSInteger wayAt(NSString *via) {
  for (NSInteger i = 0; i < kWayCount; i++)
    if ([kWays[i][0] isEqual:via]) return i;
  return -1;
}

/// What the app made that no way here sees, by the op's word for each kind, as a person reads it.
static NSString *const kUnseen[][2] = {
    {@"webview", @"web views: %@"},
    {@"background", @"background sessions: %@"},
    {@"websocket", @"WebSocket tasks: %@"},
};

/// Those counts as one line, or none where the app made none of them.
NSString *_Nullable MVNetworkUnseenLine(NSDictionary *unseen) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSUInteger i = 0; i < sizeof kUnseen / sizeof kUnseen[0]; i++)
    if ([unseen[kUnseen[i][0]] integerValue] > 0) [parts addObject:MVFormat(kUnseen[i][1], @[[unseen[kUnseen[i][0]] description]])];
  return parts.count ? MVFormat(@"Not seen here: %@", @[[parts componentsJoinedByString:@", "]]) : nil;
}

/// A speed set in an agent's own words, as a person reads it: `delayMs=300 loss=5` is 300 ms and 5 % lost.
static NSString *customSpeed(NSString *value) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSString *word in [value componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet]) {
    NSArray<NSString *> *pair = [word componentsSeparatedByString:@"="];
    double n = pair.lastObject.doubleValue;
    if (pair.count != 2) [parts addObject:word];
    else if ([pair[0] isEqual:@"delayMs"]) [parts addObject:MVNetworkTook(n)];
    else if ([pair[0] isEqual:@"loss"]) [parts addObject:MVFormat(@"%@ lost", @[MVPercent(n)])];
    else [parts addObject:[NSString stringWithFormat:@"%@/s %@", MVNetworkSize(n), [pair[0] isEqual:@"up"] ? @"↑" : @"↓"]];
  }
  return [parts componentsJoinedByString:@", "];
}

/// The time gone since a capture began, as a clock counts it.
static NSString *elapsed(NSDate *since) {
  long s = MAX(0, (long)-since.timeIntervalSinceNow);
  return s < 3600 ? [NSString stringWithFormat:@"%02ld:%02ld", s / 60, s % 60] : [NSString stringWithFormat:@"%ld:%02ld:%02ld", s / 3600, s / 60 % 60, s % 60];
}

static NSString *timeOf(NSDate *when) {
  NSDateFormatter *format = [NSDateFormatter new];
  format.dateStyle = NSDateFormatterNoStyle;
  format.timeStyle = NSDateFormatterShortStyle;
  return [format stringFromDate:when];
}

NSString *MVNetworkWayTitle(NSString *via) {
  NSInteger at = wayAt(via);
  return MVWord(at < 0 ? via : kWays[at][1]);
}

@implementation MVNetworkPane (Says)

- (void)fillSpeeds {
  for (NSInteger i = 0; i < kSpeedCount; i++) [_throttle addItemWithTitle:MVWord(kSpeeds[i][1])];
}

/// What the pane's foot says: a send under way, or the parent's answer. What went well goes by itself; what did not stays.
- (void)foot:(NSDictionary *)m {
  if (m[@"sending"]) [_answer sending:m[@"sending"]];
  else [_answer show:m];
  NSUInteger now = ++_answered;
  if (![m[@"ok"] boolValue]) return;
  __weak MVNetworkPane *weak = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kGoneSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    MVNetworkPane *pane = weak;
    if (pane && pane->_answered == now) pane->_answer.hidden = YES;
  });
}

/// A speed chosen is the probe's throttle, by the op an agent sets it with.
- (void)throttleChosen:(id)sender {
  NSInteger at = _throttle.indexOfSelectedItem;
  if (at >= 0 && at < kSpeedCount) MVPaneSend(self, @{@"op": @"control", @"name": @"networkThrottle", @"value": kSpeeds[at][0]});
}

/// The speed the probe holds, chosen in the list: one set in other words, as an agent may, stands there as a person reads it.
- (void)showThrottle:(NSString *)value {
  NSInteger at = 0;
  while (at < kSpeedCount && ![kSpeeds[at][0] isEqual:value]) at++;
  while (_throttle.numberOfItems > kSpeedCount) [_throttle removeItemAtIndex:kSpeedCount];
  if (at == kSpeedCount) {
    [_throttle addItemWithTitle:customSpeed(value)];
    _throttle.lastItem.toolTip = value;
  }
  [_throttle selectItemAtIndex:at];
  _tortoise.hidden = at == 0;
  _throttle.accessibilityValue = _throttle.titleOfSelectedItem;
}

/// What the capture's row says: the time gone and how many requests, or when it stopped.
- (void)sayState {
  NSInteger chosen = wayAt(_capturing ?: @"");
  BOOL lists = [@[@"probe", @"proxy"] containsObject:_capturing ?: @""] || (!_capturing && _allRows.count);
  NSString *count = MVFormat(_total == 1 ? @"%@ request" : @"%@ requests", @[MVCount(_total)]);
  NSString *first = _capturing ? elapsed(_since ?: NSDate.date) : _stopped ? MVFormat(@"Stopped at %@", @[timeOf(_stopped)])
                                                                           : MVWord(@"Not capturing");
  _state.stringValue = lists ? [NSString stringWithFormat:@"%@ · %@", first, count] : first;
  NSString *spoken = _capturing && chosen >= 0 ? MVFormat(kCapturing[chosen], @[timeOf(_since ?: NSDate.date)]) : first;
  _state.accessibilityLabel = lists ? [NSString stringWithFormat:@"%@, %@", spoken, count] : spoken;
}

/// What the card says where no request is listed: what the way chosen does, what the device lacks, or that it listens.
- (void)sayCard:(NSString *)via {
  NSInteger chosen = wayAt(via ?: @"");
  NSString *title = chosen >= 0 ? MVWord(kWays[chosen][2]) : MVWord(@"No requests to show on this device"), *words = chosen >= 0 ? MVWord(kWays[chosen][3]) : @"";
  BOOL counts = _capturing && ![@[@"probe", @"proxy"] containsObject:_capturing];
  if (_capturing && !counts) {
    title = MVWord(@"Listening");
    words = MVWord(@"Make a request in the app, and it shows here.");
  }
  // what a capture says of itself keeps an address or an app as it came
  if (_noteSaid.length) words = MVSentence(_noteSaid);
  // what the app made that this way cannot see, so that an empty list is not read as an app that asked for nothing
  if (_unseen.length && _capturing) words = [NSString stringWithFormat:@"%@\n%@", words, _unseen];
  // what lists no requests says what would, while it counts too
  if (_needs && !_capturing) words = chosen >= 0 ? [NSString stringWithFormat:@"%@\n%@", words, MVWord(_needs)] : MVWord(_needs);
  else if (_needs && counts) words = [NSString stringWithFormat:@"%@\n%@", words, MVWord(_needs)];
  _cardTitle.stringValue = title;
  _cardWords.stringValue = words;
  _cardWords.hidden = !words.length;
}

@end
