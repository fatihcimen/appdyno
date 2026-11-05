// The Performance pane: what the cards read over a longer time, and the real measures of the app in front. The measures
// are the ones an agent calls, run by the parent and kept with every other run: this draws what it is told.
#import "Window.h"

enum { kMinutes = 10, kResults = 20 };
static const double kTrendHeight = 40, kBetween = 12;

/// What a line of the longer history shows, in the order it stands.
typedef struct {
  const char *field, *title, *unit;
} MVTrendRow;

static const MVTrendRow kTrends[] = {
    {"fps", "Frame rate", "fps"},
    {"cpuPercent", "CPU", "%"},
    {"memoryMb", "Memory", "MB"},
};
enum { kTrendCount = sizeof kTrends / sizeof kTrends[0] };

static NSTextField *note(NSString *text) {
  NSTextField *field = [NSTextField wrappingLabelWithString:text];
  field.font = [NSFont systemFontOfSize:11];
  field.textColor = NSColor.secondaryLabelColor;
  field.maximumNumberOfLines = 3;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

static NSTextField *heading(NSString *text) {
  NSTextField *field = [NSTextField labelWithString:text];
  field.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
  field.textColor = NSColor.secondaryLabelColor;
  return field;
}

NSTextField *MVPaneNote(NSString *text) {
  return note(text);
}

NSTextField *MVPaneHeading(NSString *text) {
  return heading(text);
}

/// A control of the table, as a button of a pane.
static NSButton *button(NSString *name, id target) {
  NSButton *button = [NSButton buttonWithTitle:[[MVControlTitle(name) componentsSeparatedByString:@" "] lastObject] image:MVControlImage(name) ?: [NSImage new] target:target action:@selector(control:)];
  button.identifier = name;
  button.accessibilityLabel = MVControlTitle(name);
  button.imagePosition = NSImageLeading;
  return button;
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
  trend.now = [NSTextField labelWithString:@"–"];
  trend.now.font = [NSFont monospacedDigitSystemFontOfSize:11 weight:NSFontWeightMedium];
  NSView *gap = [NSView new];
  [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSTextField *name = note(@(row->title));
  NSStackView *head = [NSStackView stackViewWithViews:@[name, gap, trend.now]];
  trend.line = [MVSpark new];
  trend.line.capacity = kMinutes * 60;
  trend.line.hidden = YES;
  [trend.line.heightAnchor constraintEqualToConstant:kTrendHeight].active = YES;
  trend.why = note(@"");
  trend.why.hidden = YES;
  NSStackView *stack = [NSStackView stackViewWithViews:@[head, trend.line, trend.why]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 2;
  for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
  trend.view = stack;
  return trend;
}

@implementation MVPerfPane {
  NSMutableArray<MVTrend *> *_trends;
  NSTextField *_app, *_doing;
  NSProgressIndicator *_spinner;
  NSArray<NSButton *> *_measures;
  NSMutableArray<MVRow *> *_kept;
  MVList *_results;
  NSNumber *_pictureRate;
}

- (instancetype)initWithFrame:(NSRect)frame target:(id)target {
  if ((self = [super initWithFrame:frame])) {
    _kept = [NSMutableArray array];
    _trends = [NSMutableArray array];
    NSMutableArray<NSView *> *lines = [NSMutableArray array];
    for (size_t i = 0; i < kTrendCount; i++) {
      [_trends addObject:trendOf(&kTrends[i])];
      [lines addObject:_trends.lastObject.view];
    }
    _app = note(@"Open an app, then measure it. It restarts.");
    _measures = @[button(@"measureLaunch", target), button(@"measureScroll", target), button(@"journey", target)];
    NSStackView *measures = [NSStackView stackViewWithViews:_measures];
    measures.distribution = NSStackViewDistributionFillEqually;
    _spinner = [NSProgressIndicator new];
    _spinner.style = NSProgressIndicatorStyleSpinning;
    _spinner.controlSize = NSControlSizeSmall;
    _spinner.displayedWhenStopped = NO;
    _doing = note(@"");
    NSStackView *doing = [NSStackView stackViewWithViews:@[_spinner, _doing]];
    doing.hidden = YES;
    _results = [MVList new];
    NSStackView *stack = [NSStackView stackViewWithViews:@[heading(@"Measure"), _app, measures, doing]];
    [stack addArrangedSubview:heading(@"Readings, while this was open")];
    for (NSView *line in lines) [stack addArrangedSubview:line];
    [stack addArrangedSubview:heading(@"Results")];
    [stack addArrangedSubview:_results];
    [stack addArrangedSubview:button(@"dashboard", target)];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 6;
    for (NSView *line in stack.arrangedSubviews) [line.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:doing];
    [stack setCustomSpacing:kBetween afterView:lines.lastObject];
    [_results setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor constant:6],
      [stack.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:4],
      [stack.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-4],
      [stack.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
  }
  return self;
}

- (void)setPictureRate:(double)rate {
  _pictureRate = @(rate);
}

- (void)show:(NSDictionary *)message {
  NSDictionary *sample = message[@"sample"];
  if ([sample[@"app"] isKindOfClass:NSString.class]) _app.stringValue = [NSString stringWithFormat:@"A measure restarts %@.", sample[@"app"]];
  for (MVTrend *trend in _trends) {
    NSNumber *value = MVReadingOf(sample, trend.field, _pictureRate);
    NSString *why = sample[@"absent"][trend.field];
    trend.why.stringValue = why ?: @"";
    trend.why.hidden = !why;
    BOOL still = [trend.field isEqual:@"fps"] && value && value.doubleValue <= 0;
    trend.now.stringValue = still ? @"Still" : value ? MVReadingWords(value.doubleValue, trend.unit) : @"–";
    if (!value) continue;
    trend.line.color = NSColor.controlAccentColor;
    [trend.line pass];
    [trend.line add:value.doubleValue];
  }
}

- (void)showMeasuring:(NSString *)line {
  _doing.stringValue = line;
  _doing.superview.hidden = NO;
  [_spinner startAnimation:nil];
  for (NSButton *measure in _measures) measure.enabled = NO;
}

- (void)showMeasured:(NSDictionary *)result {
  [_spinner stopAnimation:nil];
  _doing.superview.hidden = YES;
  for (NSButton *measure in _measures) measure.enabled = YES;
  MVRow *row = [MVRow new];
  // that it ran is no verdict: only what its tool found in it, or that it did not run, gets a mark of its own
  BOOL plain = [result[@"ok"] boolValue] && ![result[@"flagged"] boolValue];
  row.title = [result[@"value"] length] ? [NSString stringWithFormat:@"%@  %@", result[@"title"], result[@"value"]] : result[@"title"] ?: @"";
  row.detail = result[@"detail"] ?: @"";
  row.help = result[@"why"];
  row.symbol = plain ? @"chart.bar" : @"exclamationmark.triangle";
  row.tint = plain ? NSColor.secondaryLabelColor : NSColor.systemOrangeColor;
  [_kept addObject:row];
  if (_kept.count > kResults) [_kept removeObjectAtIndex:0];
  _results.rows = _kept;
  [_results scrollToEnd];
}

- (NSString *)shownFor:(NSString *)field {
  for (MVTrend *trend in _trends)
    if ([trend.field isEqual:field]) return trend.now.stringValue;
  return @"";
}

- (BOOL)lastMarked {
  return [_kept.lastObject.symbol isEqual:@"exclamationmark.triangle"];
}

- (NSString *)lastResult {
  return _kept.lastObject.title ?: @"";
}

@end
