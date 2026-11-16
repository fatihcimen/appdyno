// One request of the Network pane, on a card under the list: how it ended and what there is to do with it, its
// address, how its time was spent, and its headers, what was sent and what came back, one of the three at a time in a
// well of its own. It is drawn at once from what the list has of the request, and filled when the parent gives its parts.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBar = 6, kBarRound = 3, kWellRound = 9, kWellInset = 10;

/// How a request's time was spent, as parts of one line: the wait for the server in the accent, as the figure one came for.
@interface MVTimingBar : NSView
@property(nonatomic, copy) NSArray<NSArray *> *phases;
@end

@implementation MVTimingBar

- (void)setPhases:(NSArray<NSArray *> *)phases {
  _phases = [phases copy];
  self.needsDisplay = YES;
}

- (NSSize)intrinsicContentSize {
  return NSMakeSize(NSViewNoIntrinsicMetric, kBar);
}

- (void)drawRect:(NSRect)dirty {
  double all = 0;
  for (NSArray *phase in _phases) all += MAX([phase[1] doubleValue], 0);
  CGFloat gaps = MAX((CGFloat)_phases.count - 1, 0), room = NSWidth(self.bounds) - gaps, least = 4, x = 0;
  // a phase too short to see still shows, and the rest share what is left
  double shown = 0;
  for (NSArray *phase in _phases) shown += MAX([phase[1] doubleValue] / MAX(all, 1) * room, least);
  for (NSArray *phase in _phases) {
    CGFloat wide = MAX([phase[1] doubleValue] / MAX(all, 1) * room, least) * room / MAX(shown, 1);
    BOOL wait = [phase[0] isEqual:MVWord(@"Wait")], heavy = [phase[0] isEqual:MVWord(@"Connect")] || [phase[0] isEqual:@"TLS"];
    [(wait ? MVAccent() : [MVQuietColor() colorWithAlphaComponent:heavy ? 0.6 : 0.35]) setFill];
    [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(x, 0, wide, kBar) xRadius:kBarRound yRadius:kBarRound] fill];
    x += wide + 1;
  }
}

@end

/// The calmest ground of the pane, for what is read closely: lighter than its card in the light look, darker in the dark.
@interface MVWellView : NSView
@end

@implementation MVWellView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  BOOL dark = MVIsDark(self.effectiveAppearance);
  self.layer.backgroundColor = (dark ? [NSColor colorWithSRGBRed:0x0A / 255.0 green:0x0E / 255.0 blue:0x2E / 255.0 alpha:0.45] : [NSColor colorWithWhite:1 alpha:0.55]).CGColor;
  self.layer.borderColor = MVRule(0.16).CGColor;
}
@end

@implementation MVNetworkDetailView {
  MVInk *_mark;
  NSTextField *_code, *_reason, *_address, *_legend, *_kind, *_none;
  MVSymbolButton *_curl, *_mock, *_wide;
  MVTimingBar *_bar;
  MVSegments *_sections;
  NSTextView *_text;
  NSView *_well;
  NSDictionary *_entry, *_parts;
  BOOL _reading;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _mark = [[MVInk alloc] initWithSymbol:@"circle" color:MVQuietColor() size:13];
    _code = MVContentText(@"", MVStyleStrong);
    _code.font = [NSFont monospacedDigitSystemFontOfSize:13 weight:NSFontWeightSemibold];
    _reason = MVContentText(@"", MVStyleCallout);
    _reason.textColor = MVQuietColor();
    _reason.lineBreakMode = NSLineBreakByTruncatingTail;
    [_reason setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [_reason setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _curl = [MVSymbolButton buttonNamed:@"networkCurl" symbol:@"doc.on.doc" size:13 label:@"Copy as cURL" target:self action:@selector(pressed:)];
    _mock = [MVSymbolButton buttonNamed:@"networkMockFrom" symbol:@"arrow.triangle.turn.up.right.diamond" size:13 label:@"Mock This Answer" target:self action:@selector(pressed:)];
    _wide = [MVSymbolButton buttonNamed:@"networkFull" symbol:@"arrow.up.left.and.arrow.down.right" size:12 label:@"Open Full" target:self action:@selector(pressed:)];
    [_mark.widthAnchor constraintEqualToConstant:16].active = YES;
    [_code setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    NSStackView *head = [NSStackView stackViewWithViews:@[_mark, _code, _reason, _curl, _mock, _wide]];
    head.spacing = 6;
    _address = MVContentText(@"", MVStyleSub);
    _address.maximumNumberOfLines = 2;
    _address.lineBreakMode = NSLineBreakByTruncatingMiddle;
    _address.cell.wraps = YES;
    _address.cell.truncatesLastVisibleLine = YES;
    _address.selectable = YES;
    _address.preferredMaxLayoutWidth = MVInspectorWidth - 2 * 16 - 2 * 14;
    _bar = [MVTimingBar new];
    _legend = MVContentText(@"", MVStyleSub);
    _legend.maximumNumberOfLines = 2;
    _legend.cell.wraps = YES;
    _legend.preferredMaxLayoutWidth = _address.preferredMaxLayoutWidth;
    _sections = [[MVSegments alloc] initWithNames:@[@"networkHeaders", @"networkRequest", @"networkResponse"] titles:@[@"Headers", @"Request", @"Response"] small:YES];
    __weak MVNetworkDetailView *weak = self;
    _sections.onChoose = ^(__unused NSInteger at) {
      [weak fill];
    };
    NSScrollView *scroll = [NSTextView scrollableTextView];
    _text = scroll.documentView;
    _text.identifier = @"networkDetail";
    _text.accessibilityLabel = MVWord(@"The request chosen");
    _text.editable = NO;
    _text.selectable = YES;
    _text.drawsBackground = NO;
    _text.usesFindBar = YES;
    _text.textContainerInset = NSMakeSize(kWellInset - 5, kWellInset);
    scroll.drawsBackground = NO;
    scroll.autohidesScrollers = YES;
    _kind = MVContentText(@"", MVStyleSub);
    _kind.font = [NSFont monospacedDigitSystemFontOfSize:10 weight:NSFontWeightRegular];
    _none = MVWrappedText(@"", MVStyleCallout);
    _none.textColor = MVQuietColor();
    _none.alignment = NSTextAlignmentCenter;
    _none.maximumNumberOfLines = 0;
    MVHoldContent(_none);
    _well = [MVWellView new];
    _well.wantsLayer = YES;
    _well.layer.cornerRadius = kWellRound;
    _well.layer.cornerCurve = kCACornerCurveContinuous;
    _well.layer.borderWidth = 1;
    _well.layer.masksToBounds = YES;
    for (NSView *part in @[scroll, _kind, _none]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [_well addSubview:part];
    }
    [NSLayoutConstraint activateConstraints:@[
      [scroll.topAnchor constraintEqualToAnchor:_well.topAnchor],
      [scroll.bottomAnchor constraintEqualToAnchor:_well.bottomAnchor],
      [scroll.leadingAnchor constraintEqualToAnchor:_well.leadingAnchor],
      [scroll.trailingAnchor constraintEqualToAnchor:_well.trailingAnchor],
      [_kind.topAnchor constraintEqualToAnchor:_well.topAnchor
                                      constant:6],
      [_kind.trailingAnchor constraintEqualToAnchor:_well.trailingAnchor
                                           constant:-kWellInset],
      [_none.centerYAnchor constraintEqualToAnchor:_well.centerYAnchor],
      [_none.leadingAnchor constraintEqualToAnchor:_well.leadingAnchor
                                          constant:kWellInset],
      [_none.trailingAnchor constraintEqualToAnchor:_well.trailingAnchor
                                           constant:-kWellInset],
      [_well.heightAnchor constraintGreaterThanOrEqualToConstant:44],
    ]];
    [_well setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSStackView *rows = MVPaneStack(@[head, _address, _bar, _legend, _sections, _well], 8);
    // as wide as the card, whatever it holds: a text view asks for no width of its own
    [_well.widthAnchor constraintEqualToAnchor:rows.widthAnchor].active = YES;
    NSView *card = MVCard(rows, 12);
    card.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:card];
    [NSLayoutConstraint activateConstraints:@[
      [card.topAnchor constraintEqualToAnchor:self.topAnchor],
      [card.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [card.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [card.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
    _live = YES;
  }
  return self;
}

- (void)pressed:(NSButton *)sender {
  if (self.onAct) self.onAct(sender.identifier);
}

- (void)setLive:(BOOL)live {
  _live = live;
  _curl.enabled = _mock.enabled = live;
  NSString *ended = MVWord(@"The capture has ended. Its requests can still be searched; copying, mocking and saving need a capture that runs.");
  _curl.toolTip = live ? MVWord(_real ? @"Copy as cURL with Real Values" : @"Copy as cURL") : ended;
  _mock.toolTip = live ? MVWord(@"Mock This Answer") : ended;
  _curl.accessibilityLabel = _curl.toolTip;
}

- (void)setReal:(BOOL)real {
  _real = real;
  self.live = _live;
}

- (void)setFull:(BOOL)full {
  _full = full;
  [_wide paint:full ? @"arrow.down.right.and.arrow.up.left" : @"arrow.up.left.and.arrow.down.right" color:MVInkColor()];
  _wide.toolTip = MVWord(full ? @"Back to the List" : @"Open Full");
  _wide.accessibilityLabel = _wide.toolTip;
  _address.maximumNumberOfLines = full ? 6 : 2;
}

- (NSInteger)section {
  return _sections.chosen;
}

/// The request the list has, at once: its head from what its row says, and its well waiting where its parts are asked for.
- (void)showEntry:(NSDictionary *)entry reading:(BOOL)reading {
  BOOL same = [_entry[@"id"] isEqual:entry[@"id"]] && _entry[@"id"];
  _entry = entry;
  if (!same) {
    _parts = nil;
    // what failed is opened for what came back
    _sections.chosen = MVNetworkFailed(entry) || [entry[@"how"] isKindOfClass:NSString.class] ? 2 : 0;
  }
  _reading = reading && !_parts;
  [self fill];
}

- (void)showParts:(NSDictionary *)parts {
  _parts = parts;
  _reading = NO;
  if ([parts[@"request"] isKindOfClass:NSDictionary.class]) {
    NSMutableDictionary *entry = [parts[@"request"] mutableCopy];
    entry[@"id"] = parts[@"id"];
    _entry = entry;
  }
  [self fill];
}

/// The head of the card: the mark and the status of the row it belongs to, in a word what that status means, and how much came.
- (void)fillHead {
  MVRow *row = MVNetworkRow(_entry, 0);
  NSInteger status = [_entry[@"status"] integerValue];
  [_mark paint:row.symbol ?: @"checkmark.circle" color:row.tint ?: MVQuietColor()];
  _code.stringValue = row.code ?: @"";
  _code.hidden = !row.code;
  NSMutableArray<NSString *> *says = [NSMutableArray array];
  NSString *how = MVNetworkFigures(@{@"how": _entry[@"how"] ?: @"", @"to": _entry[@"to"] ?: @""});
  if (how.length) [says addObject:how];
  else if ([_entry[@"inFlight"] boolValue]) [says addObject:MVNetworkFigures(_entry)];
  else if ([_entry[@"error"] length]) [says addObject:[_entry[@"error"] description]];
  // the system calls 200 "no error", which reads as if one had been looked for
  else if (status > 0) [says addObject:status == 200 ? @"OK" : [NSHTTPURLResponse localizedStringForStatusCode:status].capitalizedString];
  if (_entry[@"ms"] && ![_entry[@"inFlight"] boolValue] && [_entry[@"ms"] doubleValue] > 0) [says addObject:MVNetworkTook([_entry[@"ms"] doubleValue])];
  if ([_entry[@"bytes"] doubleValue] > 0) [says addObject:MVNetworkSize([_entry[@"bytes"] doubleValue])];
  _reason.stringValue = [says componentsJoinedByString:@" · "];
  _reason.toolTip = _reason.stringValue;
  NSMutableAttributedString *address = [[NSMutableAttributedString alloc] initWithString:[[(_entry[@"method"] ?: @"GET") description].uppercaseString stringByAppendingString:@"  "] attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold], NSForegroundColorAttributeName: MVQuietColor()}];
  [address appendAttributedString:[[NSAttributedString alloc] initWithString:[_entry[@"url"] description] ?: @"" attributes:@{NSFontAttributeName: [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular], NSForegroundColorAttributeName: MVInkColor()}]];
  _address.attributedStringValue = address;
  _address.toolTip = [NSString stringWithFormat:@"#%@ %@", _entry[@"id"] ?: @"", _entry[@"url"] ?: @""];
  NSDictionary *timings = [_parts[@"timings"] isKindOfClass:NSDictionary.class] ? _parts[@"timings"] : nil;
  NSArray<NSArray *> *phases = timings && ![timings[@"cache"] boolValue] ? MVNetworkPhases(timings) : @[];
  _bar.phases = phases;
  NSMutableAttributedString *legend = [NSMutableAttributedString new];
  for (NSArray *phase in phases) {
    [legend appendAttributedString:[[NSAttributedString alloc] initWithString:[phase[0] stringByAppendingString:@" "] attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightMedium], NSForegroundColorAttributeName: MVQuietColor()}]];
    [legend appendAttributedString:[[NSAttributedString alloc] initWithString:[MVNetworkTook([phase[1] doubleValue]) stringByAppendingString:@"   "] attributes:@{NSFontAttributeName: [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightRegular], NSForegroundColorAttributeName: MVInkColor()}]];
  }
  if ([timings[@"cache"] boolValue]) [legend appendAttributedString:[[NSAttributedString alloc] initWithString:MVWord(@"From the cache") attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:11], NSForegroundColorAttributeName: MVQuietColor()}]];
  _legend.attributedStringValue = legend;
  _legend.toolTip = timings ? [NSString stringWithFormat:@"%@\n%@", MVNetworkConnection(timings), MVWord(@"Measured on the probe's own connection, not the app's")] : nil;
  _bar.hidden = !phases.count;
  _legend.hidden = !legend.length;
}

/// The well: the section chosen, or in its place why there is nothing to read in it.
- (void)fill {
  if (!_entry) return;
  [self fillHead];
  NSString *none = nil, *kind = @"";
  NSAttributedString *text = [NSAttributedString new];
  NSInteger at = _sections.chosen;
  NSString *lost = _parts ? MVNetworkNotKept(_parts) : nil;
  if (_reading) none = MVWord(@"Reading");
  else if (lost) none = lost;
  else if (!_parts) none = [_entry[@"body"] boolValue] ? MVWord(@"Its body is in the proxy's export") : _why ?
                                                                                                             : MVWord(@"This way of capturing keeps no headers or bodies.");
  else if (at == 0) text = MVNetworkHeadersText(@[@[MVWord(@"Request"), _parts[@"requestHeaders"] ?: @[]], @[MVWord(@"Response"), _parts[@"responseHeaders"] ?: @[]]]);
  else {
    NSString *body = _parts[at == 1 ? @"requestBody" : @"responseBody"];
    double size = [_parts[at == 1 ? @"requestBodySize" : @"responseBodySize"] doubleValue];
    if ([body isKindOfClass:NSString.class] && body.length) {
      text = MVNetworkBodyText(body);
      kind = [NSString stringWithFormat:@"%@ · %@", MVNetworkBodyKind(body), MVNetworkSize(size > 0 ? size : body.length)];
    } else if (size > 0) none = MVFormat(@"%@, not text or not kept", @[MVNetworkSize(size)]);
    else if (at == 2 && [_entry[@"error"] length] && ![_entry[@"how"] isKindOfClass:NSString.class]) none = MVWord(@"It never reached a server.");
    else if (at == 2 && [@[@"failed", @"unmatched", @"lost"] containsObject:_entry[@"how"] ?: @""]) none = MVWord(@"A rule ended it, and nothing came back.");
    else none = MVWord(at == 1 ? @"It sent no body." : @"Nothing came back in its body.");
  }
  // the same words again keep what a person selected in them, and where they had scrolled to
  if (![_text.textStorage isEqualToAttributedString:text]) [_text.textStorage setAttributedString:text];
  _kind.stringValue = kind;
  _none.stringValue = none ?: @"";
  _none.hidden = !none;
  _text.enclosingScrollView.hidden = none != nil;
}

- (NSString *)text {
  if (!_entry) return @"";
  if (_parts) return MVNetworkDetailText(_parts);
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  [lines addObject:[_entry[@"url"] length] ? [NSString stringWithFormat:@"%@ %@", _entry[@"method"] ?: @"GET", _entry[@"url"]] : MVNetworkRow(_entry, 0).title];
  [lines addObject:MVNetworkFigures(_entry)];
  if ([_entry[@"at"] length]) [lines addObject:MVFormat(@"At %@", @[_entry[@"at"]])];
  if (!_none.hidden) [lines addObject:_none.stringValue];
  return [lines componentsJoinedByString:@"\n"];
}

- (NSString *)shown {
  return _none.hidden ? [_text.string copy] : _none.stringValue;
}

- (NSString *)head {
  return [@[_code.stringValue, _reason.stringValue, _address.stringValue, _legend.stringValue] componentsJoinedByString:@" | "];
}

@end
