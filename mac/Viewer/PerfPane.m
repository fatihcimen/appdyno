// The Performance pane, top down: one sentence, three figures, a minute of readings, the measures, and what they came to,
// now and before. The measures are the ones an agent calls, run by the parent and kept with every other run: this draws what
// it is told.
#import "Place.h"
#import "Window.h"

enum { kSeconds = 60,
       kResults = 20 };
static const double kNewsGrows = 1.02, kFirstFrom = 14;
static const double kChartHeight = 34, kWhyWide = 244, kRowHeight = 36, kRowInset = 10, kTile = 24, kBetween = 14, kFigure = 20, kMaySwayShare = 0.1, kMaySwayFps = 3, kWaiting = 0.6;

/// What a line of readings shows, in the order it stands.
typedef struct {
  const char *field, *title, *unit;
} MVTrendRow;

static const MVTrendRow kTrends[] = {
    {"fps", "Frame rate", "fps"},
    {"cpuPercent", "CPU", "%"},
    {"memoryMb", "Memory", "MB"},
};
enum { kTrendCount = sizeof kTrends / sizeof kTrends[0] };

NSTextField *MVPaneNote(NSString *text) {
  return MVWrappedText(text, MVStyleSub);
}

NSTextField *MVPaneHeading(NSString *text) {
  return MVText(text, MVStyleHeading);
}

/// A row of a pane, the whole width of it: one of the measures, or the dashboard.
static NSButton *rowButton(NSString *name, NSInteger hue, id target) {
  NSButton *button = [MVBarButton buttonWithTitle:@"" target:target action:@selector(control:)];
  button.identifier = name;
  button.accessibilityLabel = MVControlTitle(name);
  button.bordered = NO;
  NSView *mark = MVTile(MVControlSymbol(name), MVHueTile(hue), kTile);
  NSTextField *words = MVText(MVControlTitle(name), MVStyleBody);
  NSStackView *row = [NSStackView stackViewWithViews:@[mark, words]];
  row.spacing = 10;
  row.translatesAutoresizingMaskIntoConstraints = NO;
  [button addSubview:row];
  [NSLayoutConstraint activateConstraints:@[
    [button.heightAnchor constraintEqualToConstant:kRowHeight],
    [row.leadingAnchor constraintEqualToAnchor:button.leadingAnchor
                                      constant:kRowInset],
    [row.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
  ]];
  return button;
}

/// Rows that belong together on one card, with a hairline between them.
static NSView *grouped(NSArray<NSView *> *rows) {
  NSMutableArray<NSView *> *lines = [NSMutableArray array];
  for (NSView *row in rows) {
    if (lines.count) [lines addObject:MVSeparator()];
    [lines addObject:row];
  }
  return MVCardInset(MVPlaceColumn(lines, 0), 2, 0);
}

@interface MVTrend : NSObject
@property(nonatomic) NSTextField *now, *why, *title;
@property(nonatomic) NSView *reason;
@property(nonatomic) MVSpark *line;
@property(nonatomic, copy) NSString *field, *unit;
@property(nonatomic) NSView *view;
@end

@implementation MVTrend
@end

/// A figure and its minute on a card of their own. What it cannot say stands in the same card, and the card keeps its height.
static MVTrend *trendOf(const MVTrendRow *row, NSInteger hue) {
  MVTrend *trend = [MVTrend new];
  trend.field = @(row->field);
  trend.unit = @(row->unit);
  trend.now = MVText(@"–", MVStyleBody);
  trend.now.font = MVRoundedFont(kFigure, NSFontWeightSemibold);
  trend.now.alignment = NSTextAlignmentRight;
  MVInk *dot = [[MVInk alloc] initWithSymbol:@"circle.fill" color:MVHue(hue) size:8];
  trend.title = MVText(@(row->title), MVStyleCallout);
  NSStackView *name = [NSStackView stackViewWithViews:@[dot, trend.title]];
  name.spacing = 6;
  NSView *top = MVPlaceRow(name, @[trend.now]);
  trend.line = [MVSpark new];
  trend.line.capacity = kSeconds;
  trend.line.stays = YES;
  trend.line.fills = YES;
  trend.line.glows = YES;
  trend.line.color = MVHue(hue);
  [trend.line.heightAnchor constraintEqualToConstant:kChartHeight].active = YES;
  trend.why = MVWrappedText(@"", MVStyleSub);
  trend.why.maximumNumberOfLines = 2;
  trend.why.preferredMaxLayoutWidth = kWhyWide;
  MVInk *note = [[MVInk alloc] initWithSymbol:@"info.circle" color:MVQuietColor() size:11];
  NSStackView *reason = [NSStackView stackViewWithViews:@[note, trend.why]];
  reason.spacing = 6;
  reason.alignment = NSLayoutAttributeTop;
  reason.hidden = YES;
  trend.reason = reason;
  trend.view = MVCard(MVPlaceColumn(@[top, trend.line, reason], 4), 10);
  return trend;
}

@implementation MVPerfPane {
  NSMutableArray<MVTrend *> *_trends;
  NSTextField *_sentence, *_app, *_hint;
  NSString *_shownApp;
  NSView *_slack, *_none, *_resultsCard;
  NSArray<NSButton *> *_measures;
  NSMutableArray<NSDictionary *> *_kept;
  NSArray<NSDictionary *> *_past;
  BOOL _measured, _measuring;
  MVList *_results;
  NSNumber *_pictureRate;
  double _held, _heldSince;
}

- (instancetype)initWithFrame:(NSRect)frame target:(id)target {
  if ((self = [super initWithFrame:frame])) {
    _kept = [NSMutableArray array];
    _past = @[];
    _trends = [NSMutableArray array];
    NSMutableArray<NSView *> *lines = [NSMutableArray array];
    for (size_t i = 0; i < kTrendCount; i++) {
      [_trends addObject:trendOf(&kTrends[i], (NSInteger)i)];
      [lines addObject:_trends.lastObject.view];
    }
    _sentence = MVText(@"Waiting for the first readings", MVStyleStrong);
    _app = MVPaneNote(@"Open an app, then measure it. It restarts.");
    // what a refusal says to do next, where a person reads before the next measure
    _hint = MVPaneNote(@"");
    _hint.textColor = MVOrange();
    _hint.hidden = YES;
    _measures = @[rowButton(@"measureLaunch", 0, target), rowButton(@"measureScroll", 1, target), rowButton(@"journey", 2, target)];
    _none = MVEmptyCard(@"chart.bar.xaxis", @"No results yet. A measure gives you a number to compare against.");
    _results = [MVList new];
    [_results letRowsArrive];
    _resultsCard = MVCardInset(_results, 2, 0);
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSView *measures = grouped(_measures);
    NSMutableArray<NSView *> *all = [NSMutableArray arrayWithObject:_sentence];
    [all addObjectsFromArray:lines];
    [all addObjectsFromArray:@[MVPaneHeading(@"Measure"), measures, _app, _hint, MVPaneHeading(@"Results"), _none, _resultsCard, _slack, grouped(@[rowButton(@"dashboard", 3, target)])]];
    NSStackView *stack = [NSStackView stackViewWithViews:all];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 8;
    for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:_sentence];
    [stack setCustomSpacing:kBetween afterView:lines.lastObject];
    [stack setCustomSpacing:kBetween afterView:_app];
    [stack setCustomSpacing:kBetween afterView:_hint];
    [_resultsCard setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor],
      [stack.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [stack.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [stack.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
    [self listResults];
  }
  return self;
}

- (void)setPictureRate:(double)rate {
  _pictureRate = @(rate);
}

/// One sentence a person reads before the numbers. How long a rate has held is counted from when it last moved by more than a
/// screen's own sway.
- (NSString *)sentenceFor:(nullable NSNumber *)rate {
  if (!rate) return @"Waiting for the first readings";
  double value = rate.doubleValue, now = MVNowMs();
  if (fabs(value - _held) > MAX(kMaySwayFps, _held * kMaySwayShare) || _heldSince <= 0) {
    _held = value;
    _heldSince = now;
  }
  int seconds = (int)((now - _heldSince) / 1000);
  if (value <= 0) return seconds > 0 ? [NSString stringWithFormat:@"Nothing has moved for %d s", seconds] : @"Nothing moving";
  return seconds > 0 ? [NSString stringWithFormat:@"Steady at %.0f fps for %d s", value, seconds] : [NSString stringWithFormat:@"Moving at %.0f fps", value];
}

- (void)show:(NSDictionary *)message {
  // a reading sent as a measure began is of before it, and the measure has the device to itself
  if (_measuring) return;
  NSDictionary *sample = message[@"sample"];
  for (MVTrend *trend in _trends) {
    NSNumber *value = MVReadingOf(sample, trend.field, _pictureRate);
    // a person's words: what a tool names by its id is here only the app in front
    NSString *why = [sample[@"app"] length] ? [sample[@"absent"][trend.field] stringByReplacingOccurrencesOfString:sample[@"app"] withString:@"This app"] : sample[@"absent"][trend.field];
    // a source's note starts a sentence here, as a person reads it
    trend.why.stringValue = why.length ? [[why substringToIndex:1].uppercaseString stringByAppendingString:[why substringFromIndex:1]] : @"";
    trend.reason.hidden = !why.length;
    // with no number there is nothing to draw, and with one the line says what the words cannot
    trend.line.hidden = !value;
    BOOL still = [trend.field isEqual:@"fps"] && value && value.doubleValue <= 0;
    trend.now.stringValue = still ? @"Still" : value ? MVReadingWords(value.doubleValue, trend.unit)
                                                     : @"–";
    if ([trend.field isEqual:@"fps"]) {
      _sentence.stringValue = [self sentenceFor:value];
      // the capsule counts the picture that reaches this Mac, and a device that counts its app's frames is read here
      if (value) trend.title.stringValue = [sample[@"fps"] isKindOfClass:NSNumber.class] ? @"App frame rate" : @"Picture frame rate";
    }
    if (!value) continue;
    [trend.line pass];
    [trend.line add:value.doubleValue];
  }
}

/// What it is at is the capsule's to say: here the measures only wait for it.
- (void)showMeasuring:(NSString *)line {
  _hint.hidden = YES;
  // nothing is read while it runs, so nothing read before stands as now, and how long a rate held starts again after
  _measuring = YES;
  _heldSince = 0;
  _sentence.stringValue = @"Readings wait while a measure runs";
  for (MVTrend *trend in _trends) {
    trend.now.stringValue = @"–";
    trend.line.hidden = YES;
    trend.reason.hidden = YES;
  }
  for (NSButton *measure in _measures) {
    measure.enabled = NO;
    measure.alphaValue = kWaiting;
  }
}

static MVRow *rowOfResult(NSDictionary *result) {
  MVRow *row = [MVRow new];
  // that it ran is no verdict: only what its tool found in it, or that it did not run, gets a mark of its own
  BOOL plain = [result[@"ok"] boolValue] && ![result[@"flagged"] boolValue], regression = [result[@"verdict"] isEqual:@"regression"];
  row.title = [result[@"value"] length] ? [NSString stringWithFormat:@"%@  %@", result[@"title"], result[@"value"]] : result[@"title"] ?
                                                                                                                                       : @"";
  row.detail = result[@"detail"] ?: @"";
  row.help = result[@"why"];
  row.symbol = regression ? @"arrow.up.circle.fill" : plain ? @"chart.bar"
                                                            : @"exclamationmark.triangle.fill";
  row.tint = regression ? MVRed() : plain ? MVHue(0)
                                          : MVOrange();
  return row;
}

- (void)listResults {
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  for (NSDictionary *result in [_kept arrayByAddingObjectsFromArray:_past]) [rows addObject:rowOfResult(result)];
  BOOL first = _resultsCard.hidden;
  _results.rows = rows;
  _none.hidden = _results.rows.count > 0;
  _resultsCard.hidden = !_none.hidden;
  _slack.hidden = _none.hidden;
  // only what was just measured is news: a window opening on old results shows them
  if (first && _none.hidden && _measured) MVSlideIn(_resultsCard, kFirstFrom);
}

- (void)showMeasured:(NSDictionary *)result {
  for (NSButton *measure in _measures) {
    measure.enabled = YES;
    measure.alphaValue = 1;
  }
  [_kept insertObject:result atIndex:0];
  _measured = YES;
  _measuring = NO;
  _heldSince = 0;
  _sentence.stringValue = @"Waiting for the first readings";
  NSString *hint = [result[@"hint"] isKindOfClass:NSString.class] ? result[@"hint"] : @"";
  _hint.stringValue = hint.length ? [[hint substringToIndex:1].uppercaseString stringByAppendingString:[hint substringFromIndex:1]] : @"";
  _hint.hidden = !hint.length;
  if (_kept.count > kResults) [_kept removeLastObject];
  [self listResults];
}

/// What was measured here before, newest first: what is kept on the Mac stands in for this session's own lines of the same.
- (void)showHistory:(NSDictionary *)message {
  _past = [message[@"results"] isKindOfClass:NSArray.class] ? message[@"results"] : @[];
  NSString *app = [message[@"app"] length] ? message[@"app"] : nil;
  // what was measured of the app before stays with it: another app in front starts from its own
  if (!(app == _shownApp || [app isEqual:_shownApp])) {
    [_kept removeAllObjects];
    _hint.hidden = YES;
  }
  _shownApp = app;
  // a line the Mac kept stands in for this session's own: one it has no number of to keep stays
  [_kept filterUsingPredicate:[NSPredicate predicateWithFormat:@"NOT (ok == YES AND kept == YES)"]];
  _app.stringValue = app ? [NSString stringWithFormat:@"A measure restarts %@.", app] : @"Open an app, then measure it. It restarts.";
  if (app) MVNoteFrontApp(app);
  [self listResults];
  // only a measure just made is news: a window opening on an old regression has nothing to announce
  if (_measured && [_past.firstObject[@"verdict"] isEqual:@"regression"]) {
    MVAnnounce(_past.firstObject[@"title"]);
    MVPulse(_results, kNewsGrows);
  }
  _measured = NO;
}

- (NSString *)shownFor:(NSString *)field {
  for (MVTrend *trend in _trends)
    if ([trend.field isEqual:field]) return trend.now.stringValue;
  return @"";
}

- (BOOL)lastMarked {
  return ![_results.rows.firstObject.symbol isEqual:@"chart.bar"];
}

- (NSString *)lastResult {
  return _results.rows.firstObject.title ?: @"";
}

@end
