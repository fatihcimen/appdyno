// The Network pane: the app's requests as `capture_network` gives them, by the capture that op keeps for the device, so
// an agent's and this pane's are one. Four bands stand over the list, and no more: what the capture is doing and how
// fast its network is, the requests or the rules, and the words that narrow the list. What a way does is said where a
// capture starts, in the card that holds Start; what failed stays at the pane's foot until it is read. The parent offers
// only the ways this device has, a proxy only where one is set already: no window sets a proxy.
#import "NetworkPane.h"
#import "Place.h"
#import "Words.h"

static const double kDetailHeight = 150, kBand = 28;

static NSString *const kBodiesKept = @"networkBodies";

@implementation MVNetworkPane

@synthesize onSend = _onSend, watching = _watching, answer = _answer;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _ways = @[];
    _entries = @[];
    __weak MVNetworkPane *weak = self;
    _go = MVPlacePrimary(@"Start", @"networkGo", self, @selector(go:));
    _again = MVPlaceButton(@"Read Again", @"networkRead", self, @selector(readAgain:));
    _dot = [[MVInk alloc] initWithSymbol:@"circle.fill" color:MVGreen() size:8];
    _state = MVText(@"", MVStyleCallout);
    _state.font = [NSFont monospacedDigitSystemFontOfSize:12 weight:NSFontWeightRegular];
    _state.textColor = MVQuietColor();
    MVHoldContent(_state);
    [_state setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [_state setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _tortoise = [[MVInk alloc] initWithSymbol:@"tortoise.fill" color:MVOrange() size:12];
    _tortoise.toolTip = MVWord(@"The app's network is slowed");
    _throttle = [NSPopUpButton new];
    _throttle.identifier = @"networkThrottle";
    _throttle.accessibilityLabel = MVWord(@"Network speed");
    _throttle.toolTip = MVWord(@"Network speed");
    _throttle.target = self;
    _throttle.action = @selector(throttleChosen:);
    [self fillSpeeds];
    _way = [NSPopUpButton new];
    _way.identifier = @"networkWay";
    _way.accessibilityLabel = MVWord(@"Way to capture");
    _way.target = self;
    _way.action = @selector(wayChosen:);
    for (NSView *sized in @[_dot, _tortoise, _throttle, _again, _go]) [sized setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    [_throttle setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    [_dot.widthAnchor constraintEqualToConstant:10].active = YES;
    [_tortoise.widthAnchor constraintEqualToConstant:18].active = YES;
    _captureRow = [NSStackView stackViewWithViews:@[_go, _again, _dot, _state, _tortoise, _throttle]];
    _captureRow.spacing = 6;
    [_captureRow.heightAnchor constraintEqualToConstant:kBand].active = YES;
    _sections = [[MVSegments alloc] initWithNames:@[@"networkShowRequests", @"networkShowRules"] titles:@[@"Requests", @"Rules"] small:NO];
    _sections.onChoose = ^(NSInteger at) {
      [weak sectionChosen:at];
    };
    _filter = [MVFilterField new];
    _filter.onChange = ^{
      [weak sifted];
    };
    _note = MVPaneNote(@"");
    _note.maximumNumberOfLines = 0;
    MVHoldContent(_note);
    [self makeCard];
    _answer = [MVAnswerView new];
    _list = [MVList new];
    _list.accessibilityLabel = MVWord(@"Requests");
    [_list setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    _list.onSelect = ^(MVRow *row) {
      [weak showDetail:row.key];
    };
    _curl = MVPlaceButton(@"Copy as cURL", @"networkCurl", self, @selector(pressed:));
    _mock = MVPlaceButton(@"Mock This Answer", @"networkMockFrom", self, @selector(pressed:));
    _requestTools = MVPaneRow(@[_curl, _mock]);
    NSView *card;
    _detail = MVReadText(@"networkDetail", @"The request chosen", &card);
    _detailCard = card;
    [_detailCard.heightAnchor constraintEqualToConstant:kDetailHeight].active = YES;
    // with no list, what is left goes under it all, and the answer stands at the pane's foot
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    _rules = [MVNetworkRules new];
    _rules.onSend = ^(NSDictionary *message) {
      MVPaneSend(weak, message);
    };
    [self makeMenu];
    MVPaneFill(self, @[_captureRow, _sections, _filter, _note, _card, _list, _requestTools, _detailCard, _rules, _slack, _answer], 8);
    [self layOut];
  }
  return self;
}

/// Where a capture starts, and what there is to say while none lists a request: what the way does, with Start in it.
- (void)makeCard {
  _cardTitle = MVText(@"", MVStyleStrong);
  MVHoldContent(_cardTitle);
  _cardWords = MVWrappedText(@"", MVStyleCallout);
  _cardWords.textColor = MVQuietColor();
  _cardWords.maximumNumberOfLines = 0;
  _cardWords.preferredMaxLayoutWidth = MVInspectorWidth - 2 * 16 - 2 * 14;
  MVHoldContent(_cardWords);
  _bodies = [NSButton checkboxWithTitle:MVWord(@"Keep headers and bodies") target:self action:@selector(bodiesChosen:)];
  _bodies.identifier = @"networkBodies";
  _bodies.toolTip = MVWord(@"Keeps each request's headers and text bodies while the capture runs, for its detail. They are deleted when it stops.");
  // on unless a person turned it off: a request's detail is what one opens it for
  _bodies.state = [NSUserDefaults.standardUserDefaults objectForKey:kBodiesKept] && ![NSUserDefaults.standardUserDefaults boolForKey:kBodiesKept] ? NSControlStateValueOff : NSControlStateValueOn;
  _cardRows = MVPaneStack(@[_cardTitle, _cardWords, _bodies], 8);
  _card = MVCard(_cardRows, 14);
}

/// What is done to the whole capture, behind the pane's own button: each by the name the parent takes it by.
- (void)makeMenu {
  _menu = [NSMenu new];
  _menu.autoenablesItems = YES;
  for (NSArray<NSString *> *one in @[@[@"networkSave", @"Save HAR", @"square.and.arrow.down"], @[@"networkClear", @"Clear List", @"trash"], @[@"networkReal", @"Show Real Values", @"eye"]]) {
    NSMenuItem *item = [_menu addItemWithTitle:MVWord(one[1]) action:@selector(menuChosen:) keyEquivalent:@""];
    item.target = self;
    item.identifier = one[0];
    item.image = [NSImage imageWithSystemSymbolName:one[2] accessibilityDescription:nil];
  }
  [_menu itemAtIndex:1].toolTip = MVWord(@"Empties this window's list. The capture keeps its requests, and an AI client still reads them all.");
  [_menu itemAtIndex:2].toolTip = MVWord(@"Shows headers, cookies and bodies as they were sent, here only. An AI client still gets them hidden.");
  _more = [MVSymbolButton buttonNamed:@"networkMore" symbol:@"ellipsis.circle" size:15 label:@"More" target:self action:@selector(openMenu:)];
}

- (NSView *)titleTool {
  return _more;
}

- (void)setWatching:(BOOL)watching {
  if (watching == _watching) return;
  _watching = watching;
  MVPaneWatch(self, @"network", watching, nil);
  [self keepTime];
}

/// The time gone ticks only while it is looked at.
- (void)keepTime {
  BOOL ticks = _watching && _capturing && self.window;
  if (ticks == (_tick != nil)) return;
  [_tick invalidate];
  __weak MVNetworkPane *weak = self;
  _tick = ticks ? [NSTimer scheduledTimerWithTimeInterval:1
                                                  repeats:YES
                                                    block:^(__unused NSTimer *timer) {
                                                      [weak sayState];
                                                    }]
                : nil;
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self keepTime];
}

- (void)choose:(NSString *)name {
  if (!self.probing) return;
  if (![name isEqual:@"networkReal"]) return [self send:name];
  self.real = !_real;
  [self showDetail:_list.selected.key];
}

- (BOOL)real {
  return _real;
}

/// The parent's `network`, and the answer of a start or a stop.
- (void)show:(NSDictionary *)m {
  if ([m[@"op"] isEqual:@"answer"]) {
    [self foot:m];
    _go.enabled = !_answer.waiting;
    return;
  }
  // one request whole, asked for as it was chosen: nothing else of the pane changes
  if ([m[@"detail"] isKindOfClass:NSDictionary.class]) {
    _wholeKey = [m[@"detail"][@"id"] description];
    // its parts, named here in the Mac's language; its lines as the op wrote them where the parent sent no parts
    _whole = [m[@"detail"][@"request"] isKindOfClass:NSDictionary.class] ? MVNetworkDetailText(m[@"detail"]) : [m[@"detail"][@"lines"] componentsJoinedByString:@"\n"];
    [self showDetail:_list.selected.key];
    return;
  }
  if ([m[@"curl"] isKindOfClass:NSString.class]) {
    MVCopyText(m[@"curl"], MVPlaceBoard());
    return MVSayCopied(_curl);
  }
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
  else if (!capturing) [self showThrottle:@"full"];
  // set by an agent, or in another window, since this one was last told: said once, and to a screen reader
  if ([m[@"elsewhere"] boolValue]) [self foot:@{@"ok": @YES, @"text": @"The rules or the speed were changed elsewhere"}];
  if (m[@"strict"] || m[@"unmatched"]) [_rules showStrict:[m[@"strict"] boolValue] unmatched:[m[@"unmatched"] isEqual:@"fail"]];
  if (m[@"ways"]) {
    _ways = [m[@"ways"] isKindOfClass:NSArray.class] ? m[@"ways"] : @[];
    _proxy = [m[@"proxy"] isKindOfClass:NSString.class] ? m[@"proxy"] : nil;
    _needs = [m[@"needs"] isKindOfClass:NSString.class] ? m[@"needs"] : nil;
    [_way removeAllItems];
    for (NSString *via in _ways) {
      NSString *title = MVNetworkWayTitle(via);
      [_way addItemWithTitle:[via isEqual:@"proxy"] && _proxy ? [NSString stringWithFormat:@"%@ %@", title, _proxy] : title];
    }
  }
  if (capturing) _wasProbe = NO;
  else if (m[@"was"]) _wasProbe = [m[@"was"] isEqual:@"probe"];
  if (_capturing && !capturing) _stopped = NSDate.date;
  if (!capturing && _real) self.real = NO;
  _capturing = capturing;
  _since = [m[@"since"] isKindOfClass:NSNumber.class] ? [NSDate dateWithTimeIntervalSince1970:[m[@"since"] doubleValue] / 1000] : _since;
  _noteSaid = [m[@"note"] isKindOfClass:NSString.class] ? m[@"note"] : nil;
  _unseen = [m[@"unseen"] isKindOfClass:NSDictionary.class] ? MVNetworkUnseenLine(m[@"unseen"]) : nil;
  if ([m[@"entries"] isKindOfClass:NSArray.class]) _entries = m[@"entries"];
  else if (!capturing) _entries = @[];
  // the list is the latest of what the capture holds, and says so where it holds more
  NSUInteger ended = [_entries filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *e, __unused NSDictionary *bindings) {
                                 return [e isKindOfClass:NSDictionary.class] && ![e[@"inFlight"] boolValue];
                               }]]
                         .count;
  _total = [m[@"total"] isKindOfClass:NSNumber.class] ? [m[@"total"] unsignedIntegerValue] : ended;
  _cutSays = _total > ended && ended > 0 ? MVFormat(@"Showing the latest %@ of %@ requests", @[MVCount(ended), MVCount(_total)]) : nil;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [_entries enumerateObjectsUsingBlock:^(NSDictionary *e, NSUInteger at, __unused BOOL *stop) {
    if ([e isKindOfClass:NSDictionary.class]) [rows addObject:MVNetworkRow(e, at)];
  }];
  // a probe's requests are read again every few seconds: the one a person reads stays chosen, and stays open
  _allRows = rows;
  [self listRows];
  [self layOut];
  [self showDetail:_list.selected.key];
  [self keepTime];
}

/// A control stands in the card that starts a capture, or in the row of one that runs or has ended.
static void stand(NSView *view, NSStackView *stack, NSUInteger at, BOOL wide) {
  if (view.superview == stack) return;
  [view removeFromSuperview];
  // as wide as the card, or as wide as its own words in a row
  [view setContentHuggingPriority:wide ? 1 : NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [stack insertArrangedSubview:view atIndex:MIN(at, stack.arrangedSubviews.count)];
}

/// What the pane says and offers, from what it was last told.
- (void)layOut {
  NSString *via = _capturing;
  if (!via && _ways.count) via = _ways[MAX(0, _way.indexOfSelectedItem)];
  BOOL probe = self.probing, any = _allRows.count > 0;
  // a capture that ended leaves its list, and the words that narrow it
  BOOL left = !_capturing && any, starts = !_capturing && !any;
  if (!probe) _onRules = NO;
  _sections.chosen = _onRules;
  [_sections setCount:any || probe ? MVCount(_total) : nil at:0];
  [_sections setCount:_rules.rows.count ? MVCount(_rules.rows.count) : nil at:1];
  // Start stands in the card while nothing has been captured, with the way where the device has more than one; then in
  // the capture's row, as Stop, and as Start again beside the list a capture left
  stand(_go, starts ? _cardRows : _captureRow, starts ? NSUIntegerMax : 0, starts);
  stand(_way, starts ? _cardRows : _captureRow, starts ? 2 : NSUIntegerMax, starts);
  _go.title = MVWord(_capturing ? @"Stop" : @"Start");
  _go.hidden = !_capturing && !_ways.count;
  _way.hidden = _capturing || _ways.count < 2;
  _bodies.hidden = _capturing || ![via isEqual:@"probe"];
  _captureRow.hidden = starts;
  _again.hidden = !_capturing || probe;
  _dot.hidden = !_capturing;
  _throttle.hidden = !probe;
  if (!probe) _tortoise.hidden = YES;
  else _tortoise.hidden = _throttle.indexOfSelectedItem == 0;
  [self sayState];
  _sections.hidden = !probe;
  _filter.hidden = _onRules || !(any || _filter.words.length || _filter.failedOnly);
  _rules.hidden = !_onRules;
  _list.hidden = _onRules || !_list.rows.count;
  _card.hidden = _onRules || any;
  if (!_card.hidden) [self sayCard:via];
  // the list is the latest of more; and what a capture that ended can no longer do, with why
  NSMutableArray<NSString *> *notes = [NSMutableArray array];
  if (_cutSays) [notes addObject:_cutSays];
  if (left && _wasProbe) [notes addObject:MVWord(@"The capture has ended. Its requests can still be searched; copying, mocking and saving need a capture that runs.")];
  if (any && !_list.rows.count) [notes addObject:MVWord(@"No request here matches the filter.")];
  _note.stringValue = [notes componentsJoinedByString:@"\n"];
  _note.hidden = _onRules || !notes.count;
  _slack.hidden = !_list.hidden || _onRules;
  _more.hidden = !(probe || (left && _wasProbe));
  _more.enabled = probe;
  if (!probe) _more.toolTip = _wasProbe ? MVWord(@"The capture has ended. Its requests can still be searched; copying, mocking and saving need a capture that runs.") : MVWord(@"More");
}

- (void)focusFilter {
  if (!_filter.hidden) [_filter focus];
}

- (NSArray<MVRow *> *)rows {
  return [_list.rows filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"header == NO"]];
}

- (NSString *)said {
  NSString *state = _captureRow.hidden ? MVWord(@"Not capturing") : _state.accessibilityLabel;
  return _card.hidden || _cardWords.hidden ? state : [NSString stringWithFormat:@"%@\n%@\n%@", state, _cardTitle.stringValue, _cardWords.stringValue];
}

- (NSString *)note {
  return _note.hidden ? @"" : _note.stringValue;
}

- (MVFilterField *)filter {
  return _filter;
}

- (MVNetworkRules *)rules {
  return _rules;
}

- (NSString *)detail {
  // a copy: the text view hands out its own store, which changes under a reader
  return _detailCard.hidden ? @"" : [_detail.string copy];
}

@end
