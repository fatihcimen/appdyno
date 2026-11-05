// The Flow pane: what a person's clicks have written so far, and what is under the pointer. The parent reads the device
// and keeps the recording: this draws what it is told, and says what a click is to do.
#import "Window.h"
#import "Words.h"

static const double kBetween = 10;
// the Inspector's width, less what its pane and this stack leave at the sides
static const double kWordsWide = 280;

/// What a click does, by the segment chosen; nil: it touches the device.
static NSString *clickNamed(NSInteger segment) {
  return segment == 1 ? @"copy" : segment == 2 ? @"assert" : nil;
}

@implementation MVFlowPane {
  NSButton *_record;
  NSTextField *_state, *_what, *_ids, *_writes, *_contrast;
  NSSegmentedControl *_click;
  MVList *_steps;
  NSArray<NSString *> *_look;
}

- (instancetype)initWithFrame:(NSRect)frame target:(id)target {
  if ((self = [super initWithFrame:frame])) {
    _record = [NSButton buttonWithTitle:MVWord(@"Record") image:MVControlImage(@"recordFlow") ?: [NSImage new] target:target action:@selector(control:)];
    _record.identifier = @"recordFlow";
    _record.accessibilityLabel = MVControlTitle(@"recordFlow");
    _record.imagePosition = NSImageLeading;
    _state = MVPaneNote(@"Each click is written by the element it touched.");
    _what = MVText(@"Nothing yet", MVStyleStrong);
    _what.lineBreakMode = NSLineBreakByTruncatingTail;
    _ids = MVPaneNote(@"Move the pointer over the device.");
    _writes = MVPaneNote(@"");
    _writes.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
    _writes.textColor = NSColor.labelColor;
    _writes.selectable = YES;
    _contrast = MVPaneNote(@"");
    _contrast.lineBreakMode = NSLineBreakByWordWrapping;
    _contrast.preferredMaxLayoutWidth = kWordsWide;
    _click = [NSSegmentedControl segmentedControlWithLabels:@[MVWord(@"Touches"), MVWord(@"Copies"), MVWord(@"Asserts")] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(clickChosen:)];
    _click.selectedSegment = 0;
    _click.accessibilityLabel = MVWord(@"What a click on the device does");
    _steps = [MVList new];
    _look = @[];
    NSStackView *stack = [NSStackView stackViewWithViews:@[_record, _state, MVPaneHeading(@"Under the pointer"), _what, _ids, _writes, _contrast, MVPaneHeading(@"A click on the device"), _click, MVPaneHeading(@"Steps"), _steps]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 4;
    [stack setCustomSpacing:kBetween afterView:_state];
    [stack setCustomSpacing:kBetween afterView:_contrast];
    [stack setCustomSpacing:kBetween afterView:_click];
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor constant:6],
      [stack.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:4],
      [stack.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-4],
      [stack.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [_steps.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_click.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_what.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_writes.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_contrast.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
      [_state.widthAnchor constraintEqualToAnchor:stack.widthAnchor],
    ]];
    [_steps setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
  }
  return self;
}

- (nullable NSString *)clickDoes {
  return clickNamed(_click.selectedSegment);
}

- (void)chooseClick:(NSString *)does {
  _click.selectedSegment = [does isEqual:@"copy"] ? 1 : [does isEqual:@"assert"] ? 2 : 0;
  [self clickChosen:_click];
}

- (void)clickChosen:(id)sender {
  if (self.onClick) self.onClick();
}

- (NSString *)recordTitle {
  return _record.title;
}

- (NSString *)elementShown {
  return [NSString stringWithFormat:@"%@ | %@ | %@ | %@", _what.stringValue, _ids.stringValue, _writes.stringValue, _contrast.stringValue];
}

- (NSArray<MVRow *> *)rows {
  return _steps.rows;
}

/// Why a person should look at a step: `step 3: coordinates`, as the parent's `look` says it.
- (nullable NSString *)lookAt:(NSUInteger)step {
  NSString *start = [NSString stringWithFormat:@"step %lu: ", (unsigned long)step];
  for (NSString *line in _look)
    if ([line hasPrefix:start]) return [line substringFromIndex:start.length];
  return nil;
}

- (void)show:(NSDictionary *)m {
  BOOL on = [m[@"on"] boolValue], starting = [m[@"starting"] boolValue];
  _record.title = MVWord(on ? @"Stop" : starting ? @"Starting" : @"Record");
  _record.enabled = !starting;
  _record.contentTintColor = on ? NSColor.systemRedColor : nil;
  NSArray<NSString *> *lines = [m[@"lines"] isKindOfClass:NSArray.class] ? m[@"lines"] : @[];
  _look = [m[@"look"] isKindOfClass:NSArray.class] ? m[@"look"] : @[];
  _state.stringValue = starting ? @"Reading the screen. The first time, this starts the device agent."
                       : on     ? [NSString stringWithFormat:@"Recording: %lu steps, %lu to look at", (unsigned long)lines.count, (unsigned long)_look.count]
                       : m[@"file"] ? [NSString stringWithFormat:@"Saved %@", [m[@"file"] lastPathComponent]]
                                    : @"Each click is written by the element it touched.";
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [lines enumerateObjectsUsingBlock:^(NSString *line, NSUInteger i, BOOL *stop) {
    NSString *why = [self lookAt:i + 1];
    MVRow *row = [MVRow new];
    row.title = line;
    row.detail = why ?: [NSString stringWithFormat:@"Step %lu", (unsigned long)i + 1];
    row.help = line;
    row.symbol = why ? @"exclamationmark.triangle.fill" : @"checkmark.circle.fill";
    row.tint = why ? MVOrange() : MVGreen();
    [rows addObject:row];
  }];
  _steps.rows = rows;
  [_steps scrollToEnd];
}

- (void)showElement:(NSDictionary *)m {
  BOOL named = m[@"role"] != nil;
  _what.stringValue = named ? [NSString stringWithFormat:@"%@ %@", m[@"role"], [m[@"label"] length] ? m[@"label"] : @"with no words"] : @"Nothing named here";
  NSString *ids = m[@"id"] ? [NSString stringWithFormat:@"%@  ·  id %@", m[@"ref"], m[@"id"]] : m[@"ref"];
  _ids.stringValue = named ? ids : @"A click here is written as coordinates.";
  _writes.stringValue = m[@"tap"] ?: @"";
  NSArray *issues = [m[@"contrast"] isKindOfClass:NSArray.class] ? m[@"contrast"] : @[];
  _contrast.stringValue = !named ? @"" : issues.count ? [issues componentsJoinedByString:@"\n"] : m[@"contrastNote"] ?: @"No contrast issue";
  _contrast.textColor = issues.count ? NSColor.systemOrangeColor : NSColor.secondaryLabelColor;
}

@end

/// The element's rectangle, as fractions of the picture from its top left, in a view of `size`.
NSRect MVMarkFrame(NSDictionary *rect, CGSize size) {
  double x = [rect[@"x"] doubleValue], y = [rect[@"y"] doubleValue], w = [rect[@"w"] doubleValue], h = [rect[@"h"] doubleValue];
  return NSMakeRect(x * size.width, (1 - y - h) * size.height, w * size.width, h * size.height);
}

void MVCopyText(NSString *text, NSPasteboard *board) {
  [board clearContents];
  [board setString:text forType:NSPasteboardTypeString];
}
