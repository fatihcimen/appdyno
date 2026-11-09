// The Network pane: the app's requests as `network` gives them, by the capture that op keeps for the device, so an agent's
// and this pane's are one. The parent offers only the ways this device has, a proxy only where one is set already, and
// says what a person needs where none lists requests: no window sets a proxy.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kDetailHeight = 110;

/// Each way by its name, as a person reads it, and what it shows.
static NSString *const kWays[][3] = {
    {@"probe", @"Probe", @"Restarts the app with a probe in it, then lists each request it makes through URLSession: method, address, status, time and size."},
    {@"proxy", @"Proxy", @"Lists what goes through the proxy this device already uses, where Proxyman runs it. HTTPS shows only its host unless the proxy decrypts it."},
    {@"bytes", @"Bytes", @"Counts what the app sends and receives, with no addresses."},
    {@"packets", @"Packets", @"Counts the app's packets by port when the capture stops, with no addresses."},
};
enum { kWayCount = sizeof kWays / sizeof kWays[0] };

/// What a capture by this way is doing, from a time.
static NSString *const kCapturing[kWayCount] = {@"Capturing by the probe since %@", @"Capturing through the proxy since %@", @"Counting bytes since %@", @"Counting packets since %@"};

static NSInteger wayAt(NSString *via) {
  for (NSInteger i = 0; i < kWayCount; i++)
    if ([kWays[i][0] isEqual:via]) return i;
  return -1;
}

/// A size in the Mac's language: the system's formatter says bytes in English whatever the window's language.
static NSString *sized(id bytes) {
  double n = [bytes doubleValue];
  if (n < 1000) return MVWord([NSString stringWithFormat:@"%.0f bytes", n]);
  return n < 1e6 ? [MVDecimal(n / 1e3) stringByAppendingString:@" KB"] : [MVDecimal(n / 1e6) stringByAppendingString:@" MB"];
}

/// A request's figures, or a count's, joined as a line reads them.
static NSString *figures(NSDictionary *e) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  if (e[@"status"]) [parts addObject:[e[@"status"] description]];
  if (e[@"ms"]) [parts addObject:[NSString stringWithFormat:@"%@ ms", e[@"ms"]]];
  if (e[@"packets"]) [parts addObject:MVWord([NSString stringWithFormat:@"%@ packets", e[@"packets"]])];
  if (e[@"bytes"]) [parts addObject:sized(e[@"bytes"])];
  if ([e[@"error"] length]) [parts addObject:MVFormat(@"Failed: %@", @[e[@"error"]])];
  return [parts componentsJoinedByString:@" · "];
}

static MVRow *entryRow(NSDictionary *e, NSUInteger at) {
  MVRow *row = [MVRow new];
  row.key = @(at).stringValue;
  row.detail = figures(e);
  NSString *url = [e[@"url"] isKindOfClass:NSString.class] ? e[@"url"] : nil;
  if (!url) {
    row.title = [NSString stringWithFormat:@"%@ · %@", MVWord([e[@"direction"] description] ?: @""), MVSentence([e[@"host"] description] ?: @"")];
    row.symbol = @"chart.bar";
    return row;
  }
  NSURL *parsed = [NSURL URLWithString:url];
  NSString *where = parsed.host ? [parsed.host stringByAppendingString:parsed.path] : url;
  row.title = [NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", where];
  row.help = url;
  BOOL failed = [e[@"error"] length] || [e[@"status"] integerValue] >= 400;
  row.symbol = failed ? @"exclamationmark.triangle.fill" : @"arrow.down.circle";
  if (failed) row.tint = MVRed();
  return row;
}

@implementation MVNetworkPane {
  NSTextField *_state, *_about;
  NSPopUpButton *_way;
  NSButton *_go, *_again;
  NSArray<NSString *> *_ways;
  NSString *_capturing, *_needs, *_note, *_proxy;
  NSDate *_since;
  NSArray<NSDictionary *> *_entries;
  MVList *_list;
  NSView *_none, *_detailCard, *_slack;
  NSTextView *_detail;
}

@synthesize onSend = _onSend, watching = _watching, answer = _answer;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _ways = @[];
    _entries = @[];
    _state = MVText(@"Not capturing", MVStyleStrong);
    _way = [NSPopUpButton new];
    _way.identifier = @"networkWay";
    _way.accessibilityLabel = MVWord(@"Way to capture");
    _way.target = self;
    _way.action = @selector(wayChosen:);
    [_way setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _go = MVPlacePrimary(@"Start", @"networkGo", self, @selector(go:));
    _again = MVPlaceButton(@"Read Again", @"networkRead", self, @selector(readAgain:));
    NSStackView *controls = [NSStackView stackViewWithViews:@[_way, _go, _again]];
    controls.spacing = 8;
    _about = MVPaneNote(@"");
    _about.maximumNumberOfLines = 0;
    MVHoldContent(_about);
    _answer = [MVAnswerView new];
    _none = MVEmptyCard(@"network", @"Requests show here while a capture runs.");
    _list = [MVList new];
    _list.accessibilityLabel = MVWord(@"Requests");
    [_list setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    __weak MVNetworkPane *weak = self;
    _list.onSelect = ^(MVRow *row) {
      [weak showDetail:row.key];
    };
    NSView *card;
    _detail = MVReadText(@"networkDetail", @"The request chosen", &card);
    _detailCard = card;
    [_detailCard.heightAnchor constraintEqualToConstant:kDetailHeight].active = YES;
    _detailCard.hidden = YES;
    // with no list, what is left goes under it all, where it went to the empty row of controls and stood the note at the
    // pane's foot
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    MVPaneFill(self, @[_state, controls, _about, _answer, _none, _list, _detailCard, _slack], 8);
    [self layOut];
  }
  return self;
}

- (void)setWatching:(BOOL)watching {
  if (watching == _watching) return;
  _watching = watching;
  MVPaneWatch(self, @"network", watching, nil);
}

/// One at a time: a second press would race the first for what the pane says.
- (void)go:(id)sender {
  if (_answer.waiting) return;
  NSInteger chosen = _way.indexOfSelectedItem;
  if (!_capturing && (chosen < 0 || chosen >= (NSInteger)_ways.count)) return;
  _go.enabled = NO;
  [_answer sending:MVWord(_capturing ? @"Stopping the capture" : @"Starting the capture")];
  if (_capturing) MVPaneSend(self, @{@"op": @"control", @"name": @"networkStop"});
  else MVPaneSend(self, @{@"op": @"control", @"name": @"networkStart", @"via": _ways[chosen]});
}

- (void)readAgain:(id)sender {
  MVPaneSend(self, @{@"op": @"control", @"name": @"networkRead"});
}

- (void)wayChosen:(id)sender {
  [self layOut];
}

/// The parent's `network`, and the answer of a start or a stop.
- (void)show:(NSDictionary *)m {
  if ([m[@"op"] isEqual:@"answer"]) {
    [_answer show:m];
    _go.enabled = !_answer.waiting;
    return;
  }
  NSString *capturing = [m[@"capturing"] isKindOfClass:NSString.class] ? m[@"capturing"] : nil;
  if (m[@"ways"]) {
    _ways = [m[@"ways"] isKindOfClass:NSArray.class] ? m[@"ways"] : @[];
    _proxy = [m[@"proxy"] isKindOfClass:NSString.class] ? m[@"proxy"] : nil;
    _needs = [m[@"needs"] isKindOfClass:NSString.class] ? m[@"needs"] : nil;
    [_way removeAllItems];
    for (NSString *via in _ways) {
      NSInteger at = wayAt(via);
      NSString *title = MVWord(at < 0 ? via : kWays[at][1]);
      [_way addItemWithTitle:[via isEqual:@"proxy"] && _proxy ? [NSString stringWithFormat:@"%@ %@", title, _proxy] : title];
    }
  }
  _capturing = capturing;
  _since = [m[@"since"] isKindOfClass:NSNumber.class] ? [NSDate dateWithTimeIntervalSince1970:[m[@"since"] doubleValue] / 1000] : _since;
  _note = [m[@"note"] isKindOfClass:NSString.class] ? m[@"note"] : nil;
  if ([m[@"entries"] isKindOfClass:NSArray.class]) _entries = m[@"entries"];
  else if (!capturing) _entries = @[];
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_entries enumerateObjectsUsingBlock:^(NSDictionary *e, NSUInteger at, __unused BOOL *stop) {
    if ([e isKindOfClass:NSDictionary.class]) [rows addObject:entryRow(e, at)];
  }];
  _list.rows = rows;
  [self layOut];
  [self showDetail:nil];
}

/// What the pane says and offers, from what it was last told.
- (void)layOut {
  NSString *via = _capturing;
  if (!via && _ways.count) via = _ways[MAX(0, _way.indexOfSelectedItem)];
  NSInteger chosen = wayAt(via ?: @"");
  if (_capturing && chosen >= 0) {
    NSDateFormatter *clock = [NSDateFormatter new];
    clock.dateStyle = NSDateFormatterNoStyle;
    clock.timeStyle = NSDateFormatterShortStyle;
    _state.stringValue = [NSString stringWithFormat:kCapturing[chosen], [clock stringFromDate:_since ?: NSDate.date]];
  } else _state.stringValue = @"Not capturing";
  // what a capture says of itself keeps an address or an app as it came
  NSString *about = chosen >= 0 ? MVWord(kWays[chosen][2]) : @"";
  if (_note.length) about = MVSentence(_note);
  // what lists no requests says what would, while it counts too
  BOOL counts = _capturing && ![@[@"probe", @"proxy"] containsObject:_capturing];
  if (_needs && !_capturing) about = MVWord(_needs);
  else if (_needs && counts) about = [NSString stringWithFormat:@"%@\n%@", about, MVWord(_needs)];
  _about.stringValue = about;
  _about.hidden = !about.length;
  _way.hidden = _capturing || !_ways.count;
  _go.hidden = !_capturing && !_ways.count;
  _go.title = MVWord(_capturing ? @"Stop" : @"Start");
  _again.hidden = !_capturing || [_capturing isEqual:@"probe"];
  _list.hidden = !_list.rows.count;
  _none.hidden = !_list.hidden;
  _slack.hidden = !_list.hidden;
}

/// The request chosen, whole: its address, what came back, when, and what failed.
- (void)showDetail:(nullable NSString *)key {
  NSDictionary *e = key && key.integerValue < (NSInteger)_entries.count ? _entries[key.integerValue] : nil;
  _detailCard.hidden = !e;
  if (!e) return;
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  if ([e[@"url"] length]) [lines addObject:[NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", e[@"url"]]];
  else [lines addObject:entryRow(e, 0).title];
  [lines addObject:figures(e)];
  if ([e[@"at"] length]) [lines addObject:MVFormat(@"At %@", @[e[@"at"]])];
  if ([e[@"body"] boolValue]) [lines addObject:MVWord(@"Its body is in the proxy's export")];
  _detail.string = [lines componentsJoinedByString:@"\n"];
  _detail.textColor = MVInkColor();
}

- (NSArray<MVRow *> *)rows {
  return _list.rows;
}

- (NSString *)said {
  return _about.hidden ? _state.stringValue : [NSString stringWithFormat:@"%@\n%@", _state.stringValue, _about.stringValue];
}

- (NSString *)detail {
  return _detailCard.hidden ? @"" : _detail.string;
}

@end
