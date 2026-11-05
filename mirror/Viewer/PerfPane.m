// The Performance pane, top down: one sentence, three figures, a minute of readings, the measures, and what they came to,
// now and before. The measures are the ones an agent calls, run by the parent and kept with every other run: this draws what
// it is told.
#import "Window.h"

enum { kSeconds = 60, kResults = 20 };
static const double kChartHeight = 44, kRowHeight = 32, kBetween = 12, kFigure = 22, kMaySwayShare = 0.1, kMaySwayFps = 3;

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
  NSButton *button = [MVBarButton buttonWithTitle:@"" image:MVSymbol(MVControlSymbol(name), NSColor.labelColor, 13, NSFontWeightRegular) ?: [NSImage new] target:target action:@selector(control:)];
  button.identifier = name;
  button.accessibilityLabel = MVControlTitle(name);
  button.imagePosition = NSImageLeading;
  button.imageHugsTitle = YES;
  button.alignment = NSTextAlignmentLeft;
  button.bordered = NO;
  button.wantsLayer = YES;
  button.layer.cornerRadius = 8;
  button.layer.backgroundColor = NSColor.quaternaryLabelColor.CGColor;
  button.attributedTitle = [[NSAttributedString alloc] initWithString:[@" " stringByAppendingString:MVControlTitle(name)] attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:13], NSForegroundColorAttributeName: MVSolid(NSColor.labelColor)}];
  [button.heightAnchor constraintEqualToConstant:kRowHeight].active = YES;
  return button;
}

@interface MVTrend : NSObject
@property(nonatomic) NSTextField *now, *why;
@property(nonatomic) MVSpark *line;
@property(nonatomic, copy) NSString *field, *unit;
@property(nonatomic) NSView *view, *tile;
@end

@implementation MVTrend
@end

static NSView *wideGap(void) {
  NSView *gap = [NSView new];
  [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  return gap;
}

static MVTrend *trendOf(const MVTrendRow *row) {
  MVTrend *trend = [MVTrend new];
  trend.field = @(row->field);
  trend.unit = @(row->unit);
  trend.now = MVText(@"–", MVStyleBody);
  trend.now.font = MVRoundedFont(kFigure, NSFontWeightSemibold);
  NSStackView *tile = [NSStackView stackViewWithViews:@[trend.now, MVText(@(row->title), MVStyleSub)]];
  tile.orientation = NSUserInterfaceLayoutOrientationVertical;
  tile.alignment = NSLayoutAttributeLeading;
  tile.spacing = 0;
  trend.tile = tile;
  // on the line of its name, so that a reason coming and going moves nothing under it
  trend.why = MVText(@"", MVStyleSub);
  [trend.why setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *head = [NSStackView stackViewWithViews:@[MVText(@(row->title), MVStyleSub), wideGap(), trend.why]];
  trend.line = [MVSpark new];
  trend.line.capacity = kSeconds;
  trend.line.stays = YES;
  [trend.line.heightAnchor constraintEqualToConstant:kChartHeight].active = YES;
  NSStackView *stack = [NSStackView stackViewWithViews:@[head, trend.line]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 2;
  for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  trend.view = stack;
  return trend;
}

@implementation MVPerfPane {
  NSMutableArray<MVTrend *> *_trends;
  NSTextField *_sentence, *_app, *_doing, *_none;
  NSView *_slack;
  NSArray<NSButton *> *_measures;
  NSMutableArray<MVRow *> *_kept;
  NSArray<MVRow *> *_past;
  MVList *_results;
  NSNumber *_pictureRate;
  double _held, _heldSince;
}

- (instancetype)initWithFrame:(NSRect)frame target:(id)target {
  if ((self = [super initWithFrame:frame])) {
    _kept = [NSMutableArray array];
    _past = @[];
    _trends = [NSMutableArray array];
    NSMutableArray<NSView *> *lines = [NSMutableArray array], *tiles = [NSMutableArray array];
    for (size_t i = 0; i < kTrendCount; i++) {
      [_trends addObject:trendOf(&kTrends[i])];
      [lines addObject:_trends.lastObject.view];
      [tiles addObject:_trends.lastObject.tile];
    }
    _sentence = MVText(@"Waiting for the first readings", MVStyleCallout);
    NSStackView *figures = [NSStackView stackViewWithViews:tiles];
    figures.distribution = NSStackViewDistributionFillEqually;
    _app = MVPaneNote(@"Open an app, then measure it. It restarts.");
    _measures = @[rowButton(@"measureLaunch", target), rowButton(@"measureScroll", target), rowButton(@"journey", target)];
    _doing = MVPaneNote(@"");
    _doing.hidden = YES;
    _none = MVPaneNote(@"No results yet. A measure gives you a number to compare against.");
    _results = [MVList new];
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSMutableArray<NSView *> *all = [NSMutableArray arrayWithObjects:_sentence, figures, nil];
    [all addObjectsFromArray:lines];
    [all addObjectsFromArray:@[MVPaneHeading(@"Measure"), _app]];
    [all addObjectsFromArray:_measures];
    [all addObjectsFromArray:@[_doing, MVPaneHeading(@"Results"), _none, _results, _slack, rowButton(@"dashboard", target)]];
    NSStackView *stack = [NSStackView stackViewWithViews:all];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 4;
    for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:figures];
    [stack setCustomSpacing:kBetween afterView:lines.lastObject];
    [stack setCustomSpacing:kBetween afterView:_doing];
    [stack setCustomSpacing:kBetween afterView:_measures.lastObject];
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
  if (value <= 0) return seconds > 0 ? [NSString stringWithFormat:@"Still for %d s", seconds] : @"Still";
  return seconds > 0 ? [NSString stringWithFormat:@"Steady at %.0f fps for %d s", value, seconds] : [NSString stringWithFormat:@"Moving at %.0f fps", value];
}

- (void)show:(NSDictionary *)message {
  NSDictionary *sample = message[@"sample"];
  for (MVTrend *trend in _trends) {
    NSNumber *value = MVReadingOf(sample, trend.field, _pictureRate);
    // a person's words: what a tool names by its id is here only the app in front
    NSString *why = [sample[@"app"] length] ? [sample[@"absent"][trend.field] stringByReplacingOccurrencesOfString:sample[@"app"] withString:@"This app"] : sample[@"absent"][trend.field];
    trend.why.stringValue = why ?: @"";
    trend.why.toolTip = why;
    BOOL still = [trend.field isEqual:@"fps"] && value && value.doubleValue <= 0;
    trend.now.stringValue = still ? @"Still" : value ? MVReadingWords(value.doubleValue, trend.unit) : @"–";
    if ([trend.field isEqual:@"fps"]) _sentence.stringValue = [self sentenceFor:value];
    if (!value) continue;
    [trend.line pass];
    [trend.line add:value.doubleValue];
  }
}

- (void)showMeasuring:(NSString *)line {
  _doing.stringValue = line;
  _doing.hidden = NO;
  for (NSButton *measure in _measures) measure.enabled = NO;
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
  _results.rows = [_kept arrayByAddingObjectsFromArray:_past];
  _none.hidden = _results.rows.count > 0;
  _results.hidden = !_none.hidden;
  _slack.hidden = _none.hidden;
}

- (void)showMeasured:(NSDictionary *)result {
  _doing.hidden = YES;
  for (NSButton *measure in _measures) measure.enabled = YES;
  [_kept insertObject:rowOfResult(result) atIndex:0];
  if (_kept.count > kResults) [_kept removeLastObject];
  [self listResults];
}

/// What was measured here before, newest first: what is kept on the Mac stands in for this session's own lines of the same.
- (void)showHistory:(NSDictionary *)message {
  NSMutableArray<MVRow *> *past = [NSMutableArray array];
  for (NSDictionary *result in message[@"results"]) [past addObject:rowOfResult(result)];
  _past = past;
  _kept = [NSMutableArray arrayWithArray:[_kept filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(MVRow *row, NSDictionary *bindings) {
            return ![row.detail length] || [row.symbol isEqual:@"exclamationmark.triangle"];
          }]]];
  if ([message[@"app"] length]) _app.stringValue = [NSString stringWithFormat:@"A measure restarts %@.", message[@"app"]];
  [self listResults];
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
