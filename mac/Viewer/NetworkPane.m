// The Network pane: the app's requests as `network` gives them, by the capture that op keeps for the device, so an agent's
// and this pane's are one. The parent offers only the ways this device has, a proxy only where one is set already, and
// says what a person needs where none lists requests: no window sets a proxy.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kDetailHeight = 150;

/// How slow the probe makes the app's network: the op's word, and its name here.
static NSString *const kSpeeds[][2] = {
    {@"full", @"Full Speed"},
    {@"slow", @"Slow"},
    {@"gsm", @"GSM"},
    {@"gprs", @"GPRS"},
    {@"edge", @"EDGE"},
    {@"umts", @"3G"},
    {@"hsdpa", @"HSDPA"},
    {@"lte", @"LTE"},
};
enum { kSpeedCount = sizeof kSpeeds / sizeof kSpeeds[0] };

/// What a rule or the throttle did to a request, as the op says it, in a person's words.
static NSString *howWord(NSDictionary *e) {
  NSString *how = [e[@"how"] isKindOfClass:NSString.class] ? e[@"how"] : nil;
  if ([how isEqual:@"mocked"]) return MVWord(@"Mocked");
  if ([how isEqual:@"failed"]) return MVWord(@"Failed by a rule");
  if ([how isEqual:@"delayed"]) return MVWord(@"Delayed by a rule");
  if ([how isEqual:@"sent"]) return MVFormat(@"Sent to %@", @[[e[@"to"] description] ?: @""]);
  return [how isEqual:@"lost"] ? MVWord(@"Lost by the throttle") : nil;
}

/// Each way by its name, as a person reads it, and what it shows.
static NSString *const kWays[][3] = {
    {@"probe", @"Probe", @"Restarts the app with a probe in it, then lists each request it makes through URLSession: method, address, status, time and size."},
    {@"proxy", @"Proxy", @"Lists what goes through the proxy this device already uses, where this tool can read the proxy's list. HTTPS shows only its host unless the proxy decrypts it."},
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
  if (howWord(e)) [parts addObject:howWord(e)];
  return [parts componentsJoinedByString:@" · "];
}

/// A request by where it stands since the capture began, as the parent numbers it: its place in the list moves as the
/// oldest go, and a person's choice must not.
static NSString *keyOf(NSDictionary *e, NSUInteger at) {
  return [e[@"id"] isKindOfClass:NSNumber.class] ? [e[@"id"] stringValue] : @(at).stringValue;
}

static MVRow *entryRow(NSDictionary *e, NSUInteger at) {
  MVRow *row = [MVRow new];
  row.key = keyOf(e, at);
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
  // one a rule took is no answer of the server's: it stands apart
  row.symbol = failed ? @"exclamationmark.triangle.fill" : e[@"how"] ? @"arrow.triangle.branch"
                                                                     : @"arrow.down.circle";
  if (failed) row.tint = MVRed();
  return row;
}

@implementation MVNetworkPane {
  NSTextField *_state, *_about;
  NSPopUpButton *_way;
  NSButton *_go, *_again, *_bodies;
  NSPopUpButton *_throttle;
  MVNetworkRules *_rules;
  NSArray<MVAccentButton *> *_sections;
  NSView *_sectionRow;
  BOOL _onRules;
  NSArray<NSString *> *_ways;
  NSString *_capturing, *_needs, *_note, *_proxy, *_wholeKey, *_whole, *_askedKey;
  BOOL _keeps;
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
    _bodies = [NSButton checkboxWithTitle:MVWord(@"Keep headers and bodies") target:self action:@selector(wayChosen:)];
    _bodies.identifier = @"networkBodies";
    _throttle = [NSPopUpButton new];
    _throttle.identifier = @"networkThrottle";
    _throttle.accessibilityLabel = MVWord(@"Network speed");
    _throttle.target = self;
    _throttle.action = @selector(throttleChosen:);
    for (NSInteger i = 0; i < kSpeedCount; i++) [_throttle addItemWithTitle:MVWord(kSpeeds[i][1])];
    _rules = [MVNetworkRules new];
    // the requests or the rules: both at once leave neither the room to be read
    _sections = @[(MVAccentButton *)MVPlaceButton(@"Requests", @"networkShowRequests", self, @selector(sectionChosen:)), (MVAccentButton *)MVPlaceButton(@"Rules", @"networkShowRules", self, @selector(sectionChosen:))];
    _sections[1].tag = 1;
    _sectionRow = MVPaneRow(_sections);
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
    _rules.onSend = ^(NSDictionary *message) {
      MVPaneSend(weak, message);
    };
    MVPaneFill(self, @[_state, controls, _bodies, _throttle, _about, _answer, _sectionRow, _none, _list, _detailCard, _rules, _slack], 8);
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
  else if (!_bodies.hidden && _bodies.state == NSControlStateValueOn) MVPaneSend(self, @{@"op": @"control", @"name": @"networkStart", @"via": _ways[chosen], @"bodies": @YES});
  else MVPaneSend(self, @{@"op": @"control", @"name": @"networkStart", @"via": _ways[chosen]});
}

- (void)sectionChosen:(NSButton *)sender {
  _onRules = sender.tag == 1;
  [self layOut];
  [self showDetail:_list.selected.key];
}

/// A speed chosen is the probe's throttle, by the op an agent sets it with.
- (void)throttleChosen:(id)sender {
  NSInteger at = _throttle.indexOfSelectedItem;
  if (at >= 0 && at < kSpeedCount) MVPaneSend(self, @{@"op": @"control", @"name": @"networkThrottle", @"value": kSpeeds[at][0]});
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
  // one request whole, asked for as it was chosen: nothing else of the pane changes
  if ([m[@"detail"] isKindOfClass:NSDictionary.class]) {
    _wholeKey = [m[@"detail"][@"id"] description];
    _whole = [m[@"detail"][@"lines"] componentsJoinedByString:@"\n"];
    [self showDetail:_list.selected.key];
    return;
  }
  NSString *capturing = [m[@"capturing"] isKindOfClass:NSString.class] ? m[@"capturing"] : nil;
  _keeps = capturing && [m[@"bodies"] boolValue];
  if ([m[@"rules"] isKindOfClass:NSArray.class]) [_rules show:m[@"rules"]];
  else if (!capturing) [_rules show:@[]];
  if ([m[@"throttle"] isKindOfClass:NSString.class]) [self showThrottle:m[@"throttle"]];
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
  // a probe's requests are read again every few seconds: the one a person reads stays chosen, and stays open
  NSString *chosen = _list.selected.key;
  _list.rows = rows;
  [_list selectKey:chosen];
  [self layOut];
  [self showDetail:_list.selected.key];
}

/// The speed the probe holds, chosen in the list: one set in other words, as an agent may, stands there as it was set.
- (void)showThrottle:(NSString *)value {
  NSInteger at = 0;
  while (at < kSpeedCount && ![kSpeeds[at][0] isEqual:value]) at++;
  while (_throttle.numberOfItems > kSpeedCount) [_throttle removeItemAtIndex:kSpeedCount];
  if (at == kSpeedCount) [_throttle addItemWithTitle:value];
  [_throttle selectItemAtIndex:at];
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
  // the probe's own: bodies are asked for before it starts, and its rules and its speed hold while it runs
  _bodies.hidden = _capturing || ![via isEqual:@"probe"];
  BOOL probe = [_capturing isEqual:@"probe"];
  if (!probe) _onRules = NO;
  _throttle.hidden = _sectionRow.hidden = !probe;
  for (MVAccentButton *section in _sections) {
    BOOL chosen = (section.tag == 1) == _onRules;
    section.hue = chosen ? MVAccent() : nil;
    section.accessibilityValue = chosen ? MVWord(@"selected") : nil;
  }
  _rules.hidden = !_onRules;
  _list.hidden = _onRules || !_list.rows.count;
  _none.hidden = _onRules || _list.rows.count;
  _slack.hidden = !_list.hidden;
}

/// The request chosen, whole: its address, what came back, when, and what failed.
- (void)showDetail:(nullable NSString *)key {
  NSUInteger at = [_entries indexOfObjectPassingTest:^BOOL(NSDictionary *one, NSUInteger i, __unused BOOL *stop) {
    return [one isKindOfClass:NSDictionary.class] && [keyOf(one, i) isEqual:key];
  }];
  NSDictionary *e = at == NSNotFound ? nil : _entries[at];
  _detailCard.hidden = !e || _onRules;
  if (!e) return;
  // its headers and bodies are asked for once, where the capture keeps them, and stand in place of the line
  if (_keeps && key && ![key isEqual:_askedKey]) {
    _askedKey = key;
    MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue)});
  }
  if (_whole && [key isEqual:_wholeKey]) {
    if (![_detail.string isEqual:_whole]) _detail.string = _whole;
    _detail.textColor = MVInkColor();
    return;
  }
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  if ([e[@"url"] length]) [lines addObject:[NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", e[@"url"]]];
  else [lines addObject:entryRow(e, 0).title];
  [lines addObject:figures(e)];
  if ([e[@"at"] length]) [lines addObject:MVFormat(@"At %@", @[e[@"at"]])];
  if ([e[@"body"] boolValue]) [lines addObject:MVWord(@"Its body is in the proxy's export")];
  // the same words again keep what a person selected in them
  NSString *words = [lines componentsJoinedByString:@"\n"];
  if (![_detail.string isEqual:words]) _detail.string = words;
  _detail.textColor = MVInkColor();
}

- (NSArray<MVRow *> *)rows {
  return _list.rows;
}

- (NSString *)said {
  return _about.hidden ? _state.stringValue : [NSString stringWithFormat:@"%@\n%@", _state.stringValue, _about.stringValue];
}

- (MVNetworkRules *)rules {
  return _rules;
}

- (NSString *)detail {
  return _detailCard.hidden ? @"" : _detail.string;
}

@end
