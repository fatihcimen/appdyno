// The live numbers beside the device: one glass card a measure, in one container, each with a line of its last minute
// and its state in words and a symbol as well as a colour. What a device cannot give is a dash with the reason, never 0.
#import "Window.h"

enum { kHistory = 60, kLongest = 600 };
static const double kCardHeight = 92, kLineHeight = 26;
// a frame this long is seen as a stutter, and marked where it fell
static const double kStutterMs = 100;
// the share of frames that may come late: past the first `perf_scroll` has a finding, past the second Android vitals calls
// a session slow
static const double kLateWatch = 0.10, kLatePoor = 0.25;

/// What each card shows, in the order it stands.
typedef struct {
  const char *field, *title, *unit, *symbol;
} MVMeasureRow;

static const MVMeasureRow kCards[] = {
    {"fps", "Frame rate", "fps", "speedometer"},
    {"jankyFrames", "Jank", "frames", "waveform.path.ecg"},
    {"frozenFrames", "Frozen", "frames", "snowflake"},
    {"cpuPercent", "CPU", "%", "cpu"},
    {"memoryMb", "Memory", "MB", "memorychip"},
    {"networkInKbps", "Network", "kbit/s", "arrow.up.arrow.down"},
};

MVLiveState MVStateOf(NSString *field, double value) {
  if ([field isEqual:@"jankyFrames"]) return value <= 0 ? MVLiveGood : value <= 3 ? MVLiveWarning : MVLiveCritical;
  if ([field isEqual:@"frozenFrames"]) return value <= 0 ? MVLiveGood : MVLiveCritical;
  if ([field isEqual:@"cpuPercent"]) return value < 60 ? MVLiveGood : value < 90 ? MVLiveWarning : MVLiveCritical;
  return MVLiveNeutral;
}

MVLiveState MVFramesState(NSDictionary *sample) {
  double drawn = [sample[@"framesDrawn"] doubleValue];
  id late = sample[@"jankyFrames"];
  if (drawn <= 0 || ![late isKindOfClass:NSNumber.class]) return MVLiveNeutral;
  double share = [late doubleValue] / drawn;
  return share <= kLateWatch ? MVLiveGood : share <= kLatePoor ? MVLiveWarning : MVLiveCritical;
}

/// The words of a state: a state is never a colour alone.
static NSString *wordsOf(MVLiveState state) {
  return state == MVLiveGood ? @"Good" : state == MVLiveWarning ? @"Watch" : state == MVLiveCritical ? @"Poor" : @"";
}

static NSColor *colorOf(MVLiveState state) {
  return state == MVLiveGood ? NSColor.systemGreenColor : state == MVLiveWarning ? NSColor.systemOrangeColor : state == MVLiveCritical ? NSColor.systemRedColor : NSColor.controlAccentColor;
}

static NSString *symbolOf(MVLiveState state) {
  return state == MVLiveGood ? @"checkmark.circle.fill" : state == MVLiveWarning ? @"exclamationmark.triangle.fill" : state == MVLiveCritical ? @"xmark.octagon.fill" : nil;
}

NSNumber *MVReadingOf(NSDictionary *sample, NSString *field, NSNumber *pictureRate) {
  id value = sample[field];
  if ([value isKindOfClass:NSNumber.class]) return value;
  // what the device does not count, the window does: the picture's own rate
  return [field isEqual:@"fps"] ? pictureRate : nil;
}

NSString *MVReadingWords(double v, NSString *unit) {
  return v >= 100 || v == round(v) ? [NSString stringWithFormat:@"%.0f %@", v, unit] : [NSString stringWithFormat:@"%.1f %@", v, unit];
}

NSFont *MVRoundedFont(CGFloat size, NSFontWeight weight) {
  NSFontDescriptor *rounded = [[NSFont systemFontOfSize:size weight:weight].fontDescriptor fontDescriptorWithDesign:NSFontDescriptorSystemDesignRounded];
  return [NSFont fontWithDescriptor:rounded size:size] ?: [NSFont systemFontOfSize:size weight:weight];
}

@implementation MVSpark {
  double _values[kLongest];
  char _marks[kLongest];
  int _count;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) _capacity = kHistory;
  return self;
}

- (void)setCapacity:(int)capacity {
  _capacity = MIN(capacity, kLongest);
}

- (void)add:(double)value {
  memmove(_values, _values + 1, sizeof(double) * (_capacity - 1));
  _values[_capacity - 1] = value;
  if (_count < _capacity) _count++;
  BOOL moved = NO;
  for (int i = 0; i < _capacity; i++) moved = moved || _values[i] > 0;
  self.hidden = !moved && !self.stays;
  self.needsDisplay = YES;
}

- (void)drawRect:(NSRect)dirty {
  double top = MAX(self.usual, 1);
  for (int i = 0; i < _capacity; i++) top = MAX(top, _values[i]);
  NSRect box = self.bounds;
  // a long line starts as wide as a short one: its room is not a reason to squeeze its first minute into a corner
  int span = self.fills ? MAX(_count, 2) : MAX(_count, MIN(_capacity, kHistory));
  double height = box.size.height - 3, step = box.size.width / (span - 1);
  double (^across)(int) = ^(int i) {
    return (i - (_capacity - span)) * step;
  };
  double (^level)(double) = ^(double v) {
    return 1.5 + v / top * height;
  };
  [NSColor.separatorColor setStroke];
  NSBezierPath *base = [NSBezierPath bezierPath];
  [base moveToPoint:NSMakePoint(0, 0.5)];
  [base lineToPoint:NSMakePoint(box.size.width, 0.5)];
  [base stroke];
  if (self.usual > 0) {
    NSBezierPath *usual = [NSBezierPath bezierPath];
    [usual moveToPoint:NSMakePoint(0, level(self.usual))];
    [usual lineToPoint:NSMakePoint(box.size.width, level(self.usual))];
    CGFloat dashes[] = {3, 3};
    [usual setLineDash:dashes count:2 phase:0];
    [usual stroke];
  }
  NSBezierPath *line = [NSBezierPath bezierPath];
  for (int i = _capacity - _count; i < _capacity; i++) {
    NSPoint p = NSMakePoint(across(i), level(_values[i]));
    if (line.isEmpty) [line moveToPoint:p];
    else [line lineToPoint:p];
  }
  [(self.color ?: NSColor.controlAccentColor) setStroke];
  line.lineWidth = 2;
  line.lineJoinStyle = NSLineJoinStyleRound;
  line.lineCapStyle = NSLineCapStyleRound;
  [line stroke];
  // a stutter stands where it happened, in the second it happened
  [NSColor.systemRedColor setFill];
  for (int i = _capacity - _count; i < _capacity; i++)
    if (_marks[i]) NSRectFill(NSMakeRect(across(i) - 0.75, 0, 1.5, box.size.height));
}

- (void)mark {
  memmove(_marks, _marks + 1, _capacity - 1);
  _marks[_capacity - 1] = 1;
}

- (void)pass {
  memmove(_marks, _marks + 1, _capacity - 1);
  _marks[_capacity - 1] = 0;
}

@end

/// One measure: its name and state on a line, a large number, its last minute.
@interface MVMeasureCard : NSObject
@property(nonatomic) NSTextField *number, *state, *why;
@property(nonatomic) NSImageView *mark;
@property(nonatomic) MVSpark *spark;
@property(nonatomic, copy) NSString *field, *unit;
@property(nonatomic) NSView *pane;
@end

@implementation MVMeasureCard
@end

static NSTextField *small(NSString *text) {
  NSTextField *field = [NSTextField labelWithString:text];
  field.font = [NSFont systemFontOfSize:10.5 weight:NSFontWeightMedium];
  field.textColor = NSColor.secondaryLabelColor;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

static MVMeasureCard *cardOf(const MVMeasureRow *row) {
  MVMeasureCard *card = [MVMeasureCard new];
  card.field = @(row->field);
  card.unit = @(row->unit);
  NSImageView *icon = [NSImageView imageViewWithImage:[NSImage imageWithSystemSymbolName:@(row->symbol) accessibilityDescription:nil]];
  icon.contentTintColor = NSColor.secondaryLabelColor;
  card.state = small(@"");
  card.mark = [NSImageView new];
  NSView *gap = [NSView new];
  [gap setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  NSStackView *head = [NSStackView stackViewWithViews:@[icon, small(@(row->title)), gap, card.mark, card.state]];
  head.spacing = 4;
  card.number = [NSTextField labelWithString:@"–"];
  card.number.font = MVRoundedFont(24, NSFontWeightSemibold);
  card.spark = [MVSpark new];
  card.spark.hidden = YES;
  [card.spark.heightAnchor constraintEqualToConstant:kLineHeight].active = YES;
  card.why = small(@"");
  card.why.lineBreakMode = NSLineBreakByTruncatingTail;
  card.why.maximumNumberOfLines = 2;
  card.why.cell.wraps = YES;
  card.why.hidden = YES;
  NSStackView *stack = [NSStackView stackViewWithViews:@[head, card.number, card.spark, card.why]];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeLeading;
  stack.spacing = 2;
  stack.edgeInsets = NSEdgeInsetsMake(10, 12, 10, 12);
  [head.widthAnchor constraintEqualToAnchor:stack.widthAnchor constant:-24].active = YES;
  [card.spark.widthAnchor constraintEqualToAnchor:stack.widthAnchor constant:-24].active = YES;
  [card.why.widthAnchor constraintEqualToAnchor:stack.widthAnchor constant:-24].active = YES;
  card.pane = MVGlass(stack, 18, nil);
  [card.pane.heightAnchor constraintGreaterThanOrEqualToConstant:kCardHeight].active = YES;
  return card;
}

@implementation MVHud {
  NSMutableArray<MVMeasureCard *> *_cards;
  NSTextField *_noise;
  NSNumber *_pictureRate;
}

- (void)setPictureRate:(double)rate {
  _pictureRate = @(rate);
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _cards = [NSMutableArray array];
    NSMutableArray<NSView *> *panes = [NSMutableArray array];
    for (size_t i = 0; i < sizeof kCards / sizeof kCards[0]; i++) {
      [_cards addObject:cardOf(&kCards[i])];
      [panes addObject:_cards.lastObject.pane];
    }
    _noise = small(@"Read with a stream running");
    _noise.lineBreakMode = NSLineBreakByTruncatingMiddle;
    [_noise setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    NSStackView *stack = [NSStackView stackViewWithViews:panes];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 8;
    [stack.widthAnchor constraintEqualToConstant:MVHudWidth].active = YES;
    for (NSView *pane in panes) [pane.widthAnchor constraintEqualToConstant:MVHudWidth].active = YES;
    NSView *group = MVGlassGroup(stack);
    group.translatesAutoresizingMaskIntoConstraints = NO;
    _noise.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:group];
    [self addSubview:_noise];
    [NSLayoutConstraint activateConstraints:@[
      [group.topAnchor constraintEqualToAnchor:self.topAnchor],
      [group.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [group.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
      [_noise.topAnchor constraintEqualToAnchor:group.bottomAnchor constant:6],
      [_noise.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:6],
      [_noise.trailingAnchor constraintLessThanOrEqualToAnchor:self.trailingAnchor constant:-6],
    ]];
  }
  return self;
}

- (NSString *)shownFor:(NSString *)field {
  for (MVMeasureCard *card in _cards)
    if ([card.field isEqual:field]) return card.number.stringValue;
  return @"";
}

- (NSString *)whyFor:(NSString *)field {
  for (MVMeasureCard *card in _cards)
    if ([card.field isEqual:field]) return card.why.hidden ? @"" : card.why.stringValue;
  return @"";
}

- (void)show:(NSDictionary *)message {
  NSDictionary *sample = message[@"sample"];
  NSDictionary *absent = sample[@"absent"];
  BOOL stutter = [sample[@"worstFrameMs"] doubleValue] >= kStutterMs;
  for (MVMeasureCard *card in _cards) {
    NSNumber *value = MVReadingOf(sample, card.field, _pictureRate);
    if (!value) {
      card.number.stringValue = @"\u2013";
      card.state.stringValue = @"";
      card.why.stringValue = absent[card.field] ?: @"";
      card.why.hidden = !absent[card.field];
      card.pane.toolTip = absent[card.field];
      card.mark.image = nil;
      card.spark.hidden = YES;
      continue;
    }
    // what a source says of a reading it does give stands beside it
    card.why.stringValue = absent[card.field] ?: @"";
    card.why.hidden = !absent[card.field];
    card.pane.toolTip = absent[card.field];
    // a still screen sends nothing to count, and is no fault
    BOOL still = [card.field isEqual:@"fps"] && value.doubleValue <= 0;
    MVLiveState state = still ? MVLiveNeutral : [card.field isEqual:@"fps"] ? MVFramesState(sample) : MVStateOf(card.field, value.doubleValue);
    double v = value.doubleValue;
    card.number.stringValue = still ? @"Still" : MVReadingWords(v, card.unit);
    card.state.stringValue = wordsOf(state);
    card.mark.image = symbolOf(state) ? [NSImage imageWithSystemSymbolName:symbolOf(state) accessibilityDescription:wordsOf(state)] : nil;
    card.mark.contentTintColor = colorOf(state);
    card.spark.color = colorOf(state);
    if (stutter && [card.field isEqual:@"fps"]) [card.spark mark];
    else [card.spark pass];
    [card.spark add:v];
  }
  // whose numbers these are, and that a stream ran beside them
  BOOL mirrored = [message[@"noise"] containsObject:@"mirrored"];
  NSString *app = [sample[@"app"] isKindOfClass:NSString.class] ? sample[@"app"] : nil;
  _noise.stringValue = app ? (mirrored ? [app stringByAppendingString:@", with a stream running"] : app) : mirrored ? @"Read with a stream running" : @"";
  _noise.hidden = _noise.stringValue.length == 0;
}

@end
