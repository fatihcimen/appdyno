// The Network pane: the app's requests as `capture_network` gives them, by the capture that op keeps for the device, so an agent's
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
    {@"3g", @"3G"},
    {@"hsdpa", @"HSDPA"},
    {@"lte", @"LTE"},
    {@"offline", @"Offline"},
};
enum { kSpeedCount = sizeof kSpeeds / sizeof kSpeeds[0] };

/// Each way by its name, as a person reads it, and what it shows.
static NSString *const kWays[][3] = {
    {@"probe", @"Probe", @"Restarts the app with a probe in it, then lists each request it makes through URLSession: method, address, status, time and size. While it is in, the app's own certificate check (pinning) is not asked."},
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

/// What the app made that no way here sees, by the op's word for each kind, as a person reads it.
static NSString *const kUnseen[][2] = {
    {@"webview", @"web views: %@"},
    {@"background", @"background sessions: %@"},
    {@"websocket", @"WebSocket tasks: %@"},
};

/// Those counts as one line, or none where the app made none of them.
static NSString *unseenLine(NSDictionary *unseen) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSUInteger i = 0; i < sizeof kUnseen / sizeof kUnseen[0]; i++)
    if ([unseen[kUnseen[i][0]] integerValue] > 0) [parts addObject:MVFormat(kUnseen[i][1], @[[unseen[kUnseen[i][0]] description]])];
  return parts.count ? MVFormat(@"Not seen here: %@", @[[parts componentsJoinedByString:@", "]]) : nil;
}

@implementation MVNetworkPane {
  NSTextField *_state, *_about, *_cut;
  NSPopUpButton *_way;
  NSButton *_go, *_again, *_bodies;
  NSPopUpButton *_throttle;
  MVNetworkRules *_rules;
  MVNetworkActions *_actions;
  NSArray<MVRow *> *_allRows;
  NSArray<MVAccentButton *> *_sections;
  NSView *_sectionRow;
  BOOL _onRules;
  NSArray<NSString *> *_ways;
  NSString *_cutSays;
  NSString *_capturing, *_needs, *_note, *_unseen, *_proxy, *_wholeKey, *_whole, *_askedKey;
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
    _cut = MVPaneNote(@"");
    _cut.hidden = YES;
    MVHoldContent(_cut);
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
    _actions = [MVNetworkActions new];
    _actions.onChange = ^{
      [weak sifted];
    };
    _actions.onPress = ^(NSString *name) {
      [weak pressed:name];
    };
    MVPaneFill(self, @[_state, controls, _bodies, _throttle, _about, _answer, _sectionRow, _actions, _cut, _none, _list, _detailCard, _rules, _slack], 8);
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

/// The rows a person's words leave: each word in a row's method and address, or in its figures, in any case.
- (void)listRows {
  NSArray<NSString *> *words = [_actions.filter.lowercaseString componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  NSString *chosen = _list.selected.key;
  // those left stand under their hosts, a host with none left gone with them
  _list.rows = MVNetworkGrouped([_allRows filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(MVRow *row, __unused NSDictionary *bindings) {
                                            NSString *all = [NSString stringWithFormat:@"%@ %@ %@", row.title, row.detail, row.help ?: @""].lowercaseString;
                                            for (NSString *word in words)
                                              if (word.length && ![all containsString:word]) return NO;
                                            return YES;
                                          }]]);
  [_list selectKey:chosen];
}

/// The filter changed, or whether real values show: the list again, and the request chosen asked for again.
- (void)sifted {
  _askedKey = nil;
  _whole = nil;
  [self listRows];
  [self layOut];
  [self showDetail:_list.selected.key];
}

/// A button of the requests: what is done to one names it, and says whether real values are wanted.
- (void)pressed:(NSString *)name {
  NSString *key = _list.selected.key;
  BOOL one = [name isEqual:@"networkCurl"] || [name isEqual:@"networkMockFrom"];
  if (one && !key) return;
  NSMutableDictionary *m = [@{@"op": @"control", @"name": name} mutableCopy];
  if (one) m[@"id"] = @(key.integerValue);
  if ([name isEqual:@"networkCurl"] && _actions.real) m[@"real"] = @YES;
  MVPaneSend(self, m);
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
  if ([m[@"curl"] isKindOfClass:NSString.class]) return [_actions copied:m[@"curl"]];
  // a rule made of a request's answer stands in the rules' field, for a person to set
  if ([m[@"rule"] isKindOfClass:NSString.class]) {
    _onRules = YES;
    [_rules fill:m[@"rule"] fields:[m[@"fields"] isKindOfClass:NSDictionary.class] ? m[@"fields"] : nil];
    [self layOut];
    return [self showDetail:_list.selected.key];
  }
  NSString *capturing = [m[@"capturing"] isKindOfClass:NSString.class] ? m[@"capturing"] : nil;
  _keeps = capturing && [m[@"bodies"] boolValue];
  if ([m[@"rules"] isKindOfClass:NSArray.class]) [_rules show:m[@"rules"]];
  else if (!capturing) [_rules show:@[]];
  if ([m[@"throttle"] isKindOfClass:NSString.class]) [self showThrottle:m[@"throttle"]];
  // set by an agent, or in another window, since this one was last told: said once, and to a screen reader
  if ([m[@"elsewhere"] boolValue]) {
    [_answer show:@{@"ok": @YES, @"text": @"The rules or the speed were changed elsewhere"}];
    MVAnnounce(MVWord(@"The rules or the speed were changed elsewhere"));
  }
  if (m[@"strict"] || m[@"unmatched"]) [_rules showStrict:[m[@"strict"] boolValue] unmatched:[m[@"unmatched"] isEqual:@"fail"]];
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
  _unseen = [m[@"unseen"] isKindOfClass:NSDictionary.class] ? unseenLine(m[@"unseen"]) : nil;
  if ([m[@"entries"] isKindOfClass:NSArray.class]) _entries = m[@"entries"];
  else if (!capturing) _entries = @[];
  // the list is the latest of what the capture holds, and says so where it holds more
  NSUInteger ended = [_entries filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *e, __unused NSDictionary *bindings) {
                                 return [e isKindOfClass:NSDictionary.class] && ![e[@"inFlight"] boolValue];
                               }]]
                         .count;
  NSUInteger total = [m[@"total"] isKindOfClass:NSNumber.class] ? [m[@"total"] unsignedIntegerValue] : ended;
  _cutSays = total > ended && ended > 0 ? MVFormat(@"Showing the latest %@ of %@ requests", @[MVCount(ended), MVCount(total)]) : nil;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_entries enumerateObjectsUsingBlock:^(NSDictionary *e, NSUInteger at, __unused BOOL *stop) {
    if ([e isKindOfClass:NSDictionary.class]) [rows addObject:MVNetworkRow(e, at)];
  }];
  // a probe's requests are read again every few seconds: the one a person reads stays chosen, and stays open
  _allRows = rows;
  [self listRows];
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
  // what the app made that this way cannot see, so that a short list is not read as an app that asked for little
  if (_unseen.length && _capturing) about = about.length ? [NSString stringWithFormat:@"%@\n%@", about, _unseen] : _unseen;
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
  _actions.hidden = !probe || _onRules;
  _list.hidden = _onRules || !_list.rows.count;
  _none.hidden = _onRules || _list.rows.count;
  // the rules with their fields take the room the note of the way would
  if (_onRules) _about.hidden = YES;
  _slack.hidden = !_list.hidden;
  _cut.stringValue = _cutSays ?: @"";
  _cut.hidden = _onRules || !_cutSays;
}

/// The request chosen, whole: its address, what came back, when, and what failed.
- (void)showDetail:(nullable NSString *)key {
  NSUInteger at = [_entries indexOfObjectPassingTest:^BOOL(NSDictionary *one, NSUInteger i, __unused BOOL *stop) {
    return [one isKindOfClass:NSDictionary.class] && [MVNetworkKey(one, i) isEqual:key];
  }];
  NSDictionary *e = at == NSNotFound ? nil : _entries[at];
  _detailCard.hidden = !e || _onRules;
  _actions.hasRequest = e != nil;
  if (!e) return;
  // its headers and bodies are asked for once, where the capture keeps them, and stand in place of the line
  if (_keeps && key && ![key isEqual:_askedKey]) {
    _askedKey = key;
    if (_actions.real) MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue), @"real": @YES});
    else MVPaneSend(self, @{@"op": @"control", @"name": @"networkDetail", @"id": @(key.integerValue)});
  }
  if (_whole && [key isEqual:_wholeKey]) {
    if (![_detail.string isEqual:_whole]) _detail.string = _whole;
    _detail.textColor = MVInkColor();
    return;
  }
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  if ([e[@"url"] length]) [lines addObject:[NSString stringWithFormat:@"%@ %@", e[@"method"] ?: @"GET", e[@"url"]]];
  else [lines addObject:MVNetworkRow(e, 0).title];
  [lines addObject:MVNetworkFigures(e)];
  if ([e[@"at"] length]) [lines addObject:MVFormat(@"At %@", @[e[@"at"]])];
  if ([e[@"body"] boolValue]) [lines addObject:MVWord(@"Its body is in the proxy's export")];
  // the same words again keep what a person selected in them
  NSString *words = [lines componentsJoinedByString:@"\n"];
  if (![_detail.string isEqual:words]) _detail.string = words;
  _detail.textColor = MVInkColor();
}

- (NSArray<MVRow *> *)rows {
  return [_list.rows filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"header == NO"]];
}

- (NSString *)cut {
  return _cut.hidden ? @"" : _cut.stringValue;
}

- (NSString *)said {
  return _about.hidden ? _state.stringValue : [NSString stringWithFormat:@"%@\n%@", _state.stringValue, _about.stringValue];
}

- (MVNetworkActions *)actions {
  return _actions;
}

- (MVNetworkRules *)rules {
  return _rules;
}

- (NSString *)detail {
  return _detailCard.hidden ? @"" : _detail.string;
}

@end
