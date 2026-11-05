// The Performance pane, top down: one sentence, three figures, a minute of readings, the measures, and what they came to,
// now and before. The measures are the ones an agent calls, run by the parent and kept with every other run: this draws what
// it is told.
#import "Window.h"

enum { kSeconds = 60, kResults = 20 };
static const double kChartHeight = 36, kFigureWide = 104, kWhyWide = 170, kRowHeight = 32, kRowInset = 10, kBetween = 16, kFigure = 20, kMaySwayShare = 0.1, kMaySwayFps = 3, kWaiting = 0.6;

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
static NSButton *rowButton(NSString *name, id target) {
  NSButton *button = [MVBarButton buttonWithTitle:@"" target:target action:@selector(control:)];
  button.identifier = name;
  button.accessibilityLabel = MVControlTitle(name);
  button.bordered = NO;
  MVInk *ink = [[MVInk alloc] initWithSymbol:MVControlSymbol(name) color:MVQuietColor() size:13];
  NSTextField *words = MVText(MVControlTitle(name), MVStyleBody);
  NSStackView *row = [NSStackView stackViewWithViews:@[ink, words]];
  row.spacing = 8;
  row.translatesAutoresizingMaskIntoConstraints = NO;
  [button addSubview:row];
  [NSLayoutConstraint activateConstraints:@[
    [ink.widthAnchor constraintEqualToConstant:18],
    [button.heightAnchor constraintEqualToConstant:kRowHeight],
    [row.leadingAnchor constraintEqualToAnchor:button.leadingAnchor constant:kRowInset],
    [row.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
  ]];
  return button;
}

/// Rows that belong together, on one quiet ground with a hairline between them: a fill, as glass cannot sample glass.
static NSView *grouped(NSArray<NSView *> *rows) {
  NSMutableArray<NSView *> *lines = [NSMutableArray array];
  for (NSView *row in rows) {
    if (lines.count) {
      NSBox *rule = [NSBox new];
      rule.boxType = NSBoxSeparator;
      [lines addObject:rule];
    }
    [lines addObject:row];
  }
  NSStackView *stack = [NSStackView stackViewWithViews:lines];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.spacing = 0;
  for (NSView *line in lines) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  NSBox *ground = [NSBox new];
  ground.boxType = NSBoxCustom;
  ground.borderWidth = 0;
  ground.cornerRadius = 10;
  ground.fillColor = NSColor.quaternaryLabelColor;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [ground addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.topAnchor constraintEqualToAnchor:ground.topAnchor],
    [stack.bottomAnchor constraintEqualToAnchor:ground.bottomAnchor],
    [stack.leadingAnchor constraintEqualToAnchor:ground.leadingAnchor],
    [stack.trailingAnchor constraintEqualToAnchor:ground.trailingAnchor],
  ]];
  return ground;
}

@interface MVTrend : NSObject
@property(nonatomic) NSTextField *now, *why;
@property(nonatomic) MVSpark *line;
@property(nonatomic, copy) NSString *field, *unit;
@property(nonatomic) NSView *view;
@end

@implementation MVTrend
@end

static MVTrend *trendOf(const MVTrendRow *row) {
  MVTrend *trend = [MVTrend new];
  trend.field = @(row->field);
  trend.unit = @(row->unit);
  trend.now = MVText(@"–", MVStyleBody);
  trend.now.font = MVRoundedFont(kFigure, NSFontWeightSemibold);
  NSStackView *figure = [NSStackView stackViewWithViews:@[MVText(@(row->title), MVStyleSub), trend.now]];
  figure.orientation = NSUserInterfaceLayoutOrientationVertical;
  figure.alignment = NSLayoutAttributeLeading;
  figure.spacing = 0;
  [figure.widthAnchor constraintEqualToConstant:kFigureWide].active = YES;
  trend.line = [MVSpark new];
  trend.line.capacity = kSeconds;
  trend.line.stays = YES;
  trend.line.color = MVQuietColor();
  // in the chart's place: a reason coming and going moves nothing, and where there is one the chart has nothing to say
  trend.why = MVWrappedText(@"", MVStyleSub);
  trend.why.maximumNumberOfLines = 2;
  trend.why.preferredMaxLayoutWidth = kWhyWide;
  [trend.why setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *row2 = [NSStackView stackViewWithViews:@[figure, trend.line, trend.why]];
  row2.spacing = 12;
  [row2.heightAnchor constraintEqualToConstant:kChartHeight + 8].active = YES;
  [trend.line.heightAnchor constraintEqualToConstant:kChartHeight].active = YES;
  trend.view = row2;
  return trend;
}

@implementation MVPerfPane {
  NSMutableArray<MVTrend *> *_trends;
  NSTextField *_sentence, *_app, *_none;
  NSView *_slack;
  NSArray<NSButton *> *_measures;
  NSMutableArray<NSDictionary *> *_kept;
  NSArray<NSDictionary *> *_past;
  BOOL _measured;
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
      [_trends addObject:trendOf(&kTrends[i])];
      [lines addObject:_trends.lastObject.view];
    }
    _sentence = MVText(@"Waiting for the first readings", MVStyleCallout);
    _app = MVPaneNote(@"Open an app, then measure it. It restarts.");
    _measures = @[rowButton(@"measureLaunch", target), rowButton(@"measureScroll", target), rowButton(@"journey", target)];
    _none = MVPaneNote(@"No results yet. A measure gives you a number to compare against.");
    _results = [MVList new];
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSView *measures = grouped(_measures);
    NSMutableArray<NSView *> *all = [NSMutableArray arrayWithObject:_sentence];
    [all addObjectsFromArray:lines];
    [all addObjectsFromArray:@[MVPaneHeading(@"Measure"), measures, _app, MVPaneHeading(@"Results"), _none, _results, _slack, grouped(@[rowButton(@"dashboard", target)])]];
    NSStackView *stack = [NSStackView stackViewWithViews:all];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 8;
    for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:_sentence];
    [stack setCustomSpacing:kBetween + 8 afterView:lines.lastObject];
    [stack setCustomSpacing:kBetween + 8 afterView:_app];
    [_results setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
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
  NSDictionary *sample = message[@"sample"];
  for (MVTrend *trend in _trends) {
    NSNumber *value = MVReadingOf(sample, trend.field, _pictureRate);
    // a person's words: what a tool names by its id is here only the app in front
    NSString *why = [sample[@"app"] length] ? [sample[@"absent"][trend.field] stringByReplacingOccurrencesOfString:sample[@"app"] withString:@"This app"] : sample[@"absent"][trend.field];
    trend.why.stringValue = why ?: @"";
    trend.why.hidden = !why.length;
    trend.line.hidden = why.length > 0;
    BOOL still = [trend.field isEqual:@"fps"] && value && value.doubleValue <= 0;
    trend.now.stringValue = still ? @"Still" : value ? MVReadingWords(value.doubleValue, trend.unit) : @"–";
    if ([trend.field isEqual:@"fps"]) _sentence.stringValue = [self sentenceFor:value];
    if (!value) continue;
    [trend.line pass];
    [trend.line add:value.doubleValue];
  }
}

/// What it is at is the capsule's to say: here the measures only wait for it.
- (void)showMeasuring:(NSString *)line {
  for (NSButton *measure in _measures) {
    measure.enabled = NO;
    measure.alphaValue = kWaiting;
  }
}

static MVRow *rowOfResult(NSDictionary *result) {
  MVRow *row = [MVRow new];
  // that it ran is no verdict: only what its tool found in it, or that it did not run, gets a mark of its own
  BOOL plain = [result[@"ok"] boolValue] && ![result[@"flagged"] boolValue], regression = [result[@"verdict"] isEqual:@"regression"];
  row.title = [result[@"value"] length] ? [NSString stringWithFormat:@"%@  %@", result[@"title"], result[@"value"]] : result[@"title"] ?: @"";
  row.detail = result[@"detail"] ?: @"";
  row.help = result[@"why"];
  row.symbol = regression ? @"arrow.up.circle.fill" : plain ? @"chart.bar" : @"exclamationmark.triangle";
  row.tint = regression ? NSColor.systemRedColor : plain ? nil : MVOrange();
  return row;
}

- (void)listResults {
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  for (NSDictionary *result in [_kept arrayByAddingObjectsFromArray:_past]) [rows addObject:rowOfResult(result)];
  _results.rows = rows;
  _none.hidden = _results.rows.count > 0;
  _results.hidden = !_none.hidden;
  _slack.hidden = _none.hidden;
}

- (void)showMeasured:(NSDictionary *)result {
  for (NSButton *measure in _measures) {
    measure.enabled = YES;
    measure.alphaValue = 1;
  }
  [_kept insertObject:result atIndex:0];
  _measured = YES;
  if (_kept.count > kResults) [_kept removeLastObject];
  [self listResults];
}

/// What was measured here before, newest first: what is kept on the Mac stands in for this session's own lines of the same.
- (void)showHistory:(NSDictionary *)message {
  _past = [message[@"results"] isKindOfClass:NSArray.class] ? message[@"results"] : @[];
  // a kept line stands in for this session's own, and none kept takes nothing away
  if (_past.count) [_kept filterUsingPredicate:[NSPredicate predicateWithFormat:@"ok != YES"]];
  if ([message[@"app"] length]) _app.stringValue = [NSString stringWithFormat:@"A measure restarts %@.", message[@"app"]];
  [self listResults];
  // only a measure just made is news: a window opening on an old regression has nothing to announce
  if (_measured && [_past.firstObject[@"verdict"] isEqual:@"regression"]) {
    MVAnnounce(_past.firstObject[@"title"]);
    MVPulse(_results);
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
