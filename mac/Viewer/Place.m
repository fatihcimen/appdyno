// The parts of the hub's places. Text is solid and never vibrant, as everywhere in the hub: this window is usually behind
// the one a person types in, and its words hold 4.5:1 there too.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kPageWide = 660, kMargin = 28, kCardRound = 16, kCardInset = 14;
static const double kCopiedSeconds = 1.5, kRuleAlpha = 0.1, kPlateAlpha = 0.07, kPlateEdge = 0.16, kPlateRound = 9, kPlateHigh = 30, kPlateInset = 10;
static NSString *gFrontApp;

void MVNoteFrontApp(NSString *name) {
  gFrontApp = name;
}

NSString *_Nullable MVFrontApp(void) {
  return gFrontApp;
}

@interface MVPageView : NSView
@end

@implementation MVPageView
- (BOOL)isFlipped {
  return YES;
}
@end

NSScrollView *MVPlacePage(NSView *column) {
  NSScrollView *scroll = [NSScrollView new];
  scroll.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  MVPageView *page = [MVPageView new];
  page.translatesAutoresizingMaskIntoConstraints = NO;
  column.translatesAutoresizingMaskIntoConstraints = NO;
  [page addSubview:column];
  scroll.documentView = page;
  NSClipView *clip = scroll.contentView;
  NSLayoutConstraint *wide = [column.widthAnchor constraintEqualToConstant:kPageWide];
  wide.priority = NSLayoutPriorityDefaultHigh;
  [NSLayoutConstraint activateConstraints:@[
    [page.topAnchor constraintEqualToAnchor:clip.topAnchor],
    [page.leadingAnchor constraintEqualToAnchor:clip.leadingAnchor],
    [page.trailingAnchor constraintEqualToAnchor:clip.trailingAnchor],
    wide,
    [column.widthAnchor constraintLessThanOrEqualToAnchor:page.widthAnchor constant:-2 * kMargin],
    [column.centerXAnchor constraintEqualToAnchor:page.centerXAnchor],
    [column.topAnchor constraintEqualToAnchor:page.topAnchor constant:kMargin],
    [column.bottomAnchor constraintEqualToAnchor:page.bottomAnchor constant:-kMargin],
  ]];
  return scroll;
}

NSTextField *MVParagraph(NSString *text, MVStyle style) {
  NSTextField *field = MVWrappedText(text, style);
  field.maximumNumberOfLines = 0;
  field.preferredMaxLayoutWidth = 0;
  [field setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  return field;
}

@interface MVColumn : NSStackView
@end

@implementation MVColumn
- (void)addArrangedSubview:(NSView *)view {
  [super addArrangedSubview:view];
  [view.widthAnchor constraintEqualToAnchor:self.widthAnchor].active = YES;
}
@end

NSStackView *MVPlaceColumn(NSArray<NSView *> *views, CGFloat spacing) {
  NSStackView *column = [MVColumn new];
  column.orientation = NSUserInterfaceLayoutOrientationVertical;
  column.alignment = NSLayoutAttributeLeading;
  column.spacing = spacing;
  for (NSView *view in views) [column addArrangedSubview:view];
  return column;
}

NSTextField *MVNoteText(NSString *text) {
  NSTextField *field = MVParagraph(@"", MVStyleSub);
  NSMutableAttributedString *all = [NSMutableAttributedString new];
  [[text componentsSeparatedByString:@"`"] enumerateObjectsUsingBlock:^(NSString *part, NSUInteger at, BOOL *stop) {
    NSFont *font = at % 2 ? [NSFont monospacedSystemFontOfSize:field.font.pointSize weight:NSFontWeightRegular] : field.font;
    [all appendAttributedString:[[NSAttributedString alloc] initWithString:part attributes:@{NSFontAttributeName: font, NSForegroundColorAttributeName: field.textColor}]];
  }];
  field.attributedStringValue = all;
  return field;
}

static MVAccentButton *buttonNamed(NSString *title, NSString *name, id target, SEL action) {
  MVAccentButton *button = [MVAccentButton buttonWithTitle:MVWord(title) target:target action:action];
  button.identifier = name;
  button.bordered = NO;
  [button setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  [button setContentCompressionResistancePriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  return button;
}

NSButton *MVPlaceButton(NSString *title, NSString *name, id target, SEL action) {
  MVAccentButton *button = buttonNamed(title, name, target, action);
  button.quiet = YES;
  return button;
}

MVAccentButton *MVPlacePrimary(NSString *title, NSString *name, id target, SEL action) {
  return buttonNamed(title, name, target, action);
}

@interface MVCardView : NSView
@end

@implementation MVCardView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = MVCardFill().CGColor;
  self.layer.borderColor = MVCardEdge().CGColor;
}
@end

NSView *MVCard(NSView *content, CGFloat tall) {
  return MVCardInset(content, tall, kCardInset);
}

NSView *MVCardInset(NSView *content, CGFloat tall, CGFloat wide) {
  NSView *card = [MVCardView new];
  card.wantsLayer = YES;
  card.layer.cornerRadius = kCardRound;
  card.layer.cornerCurve = kCACornerCurveContinuous;
  card.layer.borderWidth = 1;
  content.translatesAutoresizingMaskIntoConstraints = NO;
  [card addSubview:content];
  [NSLayoutConstraint activateConstraints:@[
    [content.topAnchor constraintEqualToAnchor:card.topAnchor constant:tall],
    [content.bottomAnchor constraintEqualToAnchor:card.bottomAnchor constant:-tall],
    [content.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:wide],
    [content.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-wide],
  ]];
  return card;
}

@implementation MVNoteView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = MVSurface().CGColor;
  self.layer.borderColor = MVCardEdge().CGColor;
}
@end

NSView *MVNote(NSView *content) {
  NSView *note = [MVNoteView new];
  note.wantsLayer = YES;
  note.layer.cornerRadius = kCardRound;
  note.layer.cornerCurve = kCACornerCurveContinuous;
  note.layer.borderWidth = 1;
  content.translatesAutoresizingMaskIntoConstraints = NO;
  [note addSubview:content];
  [NSLayoutConstraint activateConstraints:@[
    [content.topAnchor constraintEqualToAnchor:note.topAnchor constant:kCardInset],
    [content.bottomAnchor constraintEqualToAnchor:note.bottomAnchor constant:-kCardInset],
    [content.leadingAnchor constraintEqualToAnchor:note.leadingAnchor constant:kCardInset],
    [content.trailingAnchor constraintEqualToAnchor:note.trailingAnchor constant:-kCardInset],
  ]];
  return note;
}

NSView *MVIndented(NSView *view, CGFloat left) {
  NSView *holder = [NSView new];
  view.translatesAutoresizingMaskIntoConstraints = NO;
  [holder addSubview:view];
  [NSLayoutConstraint activateConstraints:@[
    [view.topAnchor constraintEqualToAnchor:holder.topAnchor],
    [view.bottomAnchor constraintEqualToAnchor:holder.bottomAnchor],
    [view.leadingAnchor constraintEqualToAnchor:holder.leadingAnchor constant:left],
    [view.trailingAnchor constraintEqualToAnchor:holder.trailingAnchor],
  ]];
  return holder;
}

NSView *MVPlaceRow(NSView *words, NSArray<NSView *> *ends) {
  NSView *row = [NSView new];
  NSStackView *end = [NSStackView stackViewWithViews:ends];
  end.spacing = 8;
  [end setHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
  for (NSView *part in @[words, end]) {
    part.translatesAutoresizingMaskIntoConstraints = NO;
    [row addSubview:part];
  }
  [NSLayoutConstraint activateConstraints:@[
    [words.leadingAnchor constraintEqualToAnchor:row.leadingAnchor],
    [words.trailingAnchor constraintEqualToAnchor:end.leadingAnchor constant:-kCardInset],
    [end.trailingAnchor constraintEqualToAnchor:row.trailingAnchor],
    [words.centerYAnchor constraintEqualToAnchor:row.centerYAnchor],
    [end.centerYAnchor constraintEqualToAnchor:row.centerYAnchor],
    [words.topAnchor constraintGreaterThanOrEqualToAnchor:row.topAnchor],
    [words.bottomAnchor constraintLessThanOrEqualToAnchor:row.bottomAnchor],
    [end.topAnchor constraintGreaterThanOrEqualToAnchor:row.topAnchor],
    [end.bottomAnchor constraintLessThanOrEqualToAnchor:row.bottomAnchor],
  ]];
  NSLayoutConstraint *tight = [row.heightAnchor constraintEqualToConstant:0];
  tight.priority = NSLayoutPriorityDefaultLow;
  tight.active = YES;
  return row;
}

@interface MVPlateView : NSView
@end

@implementation MVPlateView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = MVRule(kPlateAlpha).CGColor;
  self.layer.borderColor = MVRule(kPlateEdge).CGColor;
}
@end

NSView *MVFieldPlate(NSTextField *field, NSView *_Nullable end) {
  field.bezeled = NO;
  field.bordered = NO;
  field.drawsBackground = NO;
  field.focusRingType = NSFocusRingTypeNone;
  field.textColor = MVInkColor();
  if (field.placeholderString) field.placeholderAttributedString = [[NSAttributedString alloc] initWithString:field.placeholderString attributes:@{NSForegroundColorAttributeName: MVQuietColor(), NSFontAttributeName: field.font}];
  NSView *plate = [MVPlateView new];
  plate.wantsLayer = YES;
  plate.layer.cornerRadius = kPlateRound;
  plate.layer.cornerCurve = kCACornerCurveContinuous;
  plate.layer.borderWidth = 1;
  field.translatesAutoresizingMaskIntoConstraints = NO;
  [plate addSubview:field];
  [NSLayoutConstraint activateConstraints:@[
    [plate.heightAnchor constraintEqualToConstant:kPlateHigh],
    [field.centerYAnchor constraintEqualToAnchor:plate.centerYAnchor],
    [field.leadingAnchor constraintEqualToAnchor:plate.leadingAnchor constant:kPlateInset],
  ]];
  if (!end) {
    [field.trailingAnchor constraintEqualToAnchor:plate.trailingAnchor constant:-kPlateInset].active = YES;
    return plate;
  }
  end.translatesAutoresizingMaskIntoConstraints = NO;
  [plate addSubview:end];
  [NSLayoutConstraint activateConstraints:@[
    [end.centerYAnchor constraintEqualToAnchor:plate.centerYAnchor],
    [end.trailingAnchor constraintEqualToAnchor:plate.trailingAnchor constant:-kPlateInset],
    [field.trailingAnchor constraintEqualToAnchor:end.leadingAnchor constant:-kPlateInset / 2],
  ]];
  return plate;
}

NSView *MVEmptyCard(NSString *symbol, NSString *words) {
  MVInk *mark = [[MVInk alloc] initWithSymbol:symbol color:MVQuietColor() size:16];
  [mark.widthAnchor constraintEqualToConstant:22].active = YES;
  NSStackView *line = [NSStackView stackViewWithViews:@[mark, MVPaneNote(words)]];
  line.spacing = 10;
  return MVCard(line, 10);
}

@interface MVRuleView : NSView
@end

@implementation MVRuleView
- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.backgroundColor = MVRule(kRuleAlpha).CGColor;
}
@end

NSView *MVSeparator(void) {
  NSView *line = [MVRuleView new];
  line.wantsLayer = YES;
  [line.heightAnchor constraintEqualToConstant:1].active = YES;
  return line;
}

static void (^gAskTap)(NSDictionary *);

void MVTapAsks(void (^_Nullable tap)(NSDictionary *message)) {
  gAskTap = tap;
}

void MVAskClients(NSString *what, NSDictionary *more) {
  NSMutableDictionary *message = [@{@"op": @"hub", @"action": @"clients", @"do": what} mutableCopy];
  [message addEntriesFromDictionary:more];
  if (gAskTap) return gAskTap(message);
  MVEmit(message);
}

NSTextField *MVCodeText(NSString *text) {
  NSTextField *field = [NSTextField wrappingLabelWithString:text];
  field.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
  field.textColor = MVInkColor();
  field.selectable = YES;
  [field setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
  return field;
}

static BOOL gBehind;

void MVPlaceBehind(BOOL behind) {
  gBehind = behind;
}

BOOL MVPlaceIsBehind(void) {
  return gBehind;
}

static NSString *gOpened;

void MVOpenOutside(NSString *where) {
  gOpened = where;
  if (gBehind) return;
  [NSWorkspace.sharedWorkspace openURL:[where hasPrefix:@"/"] ? [NSURL fileURLWithPath:where] : [NSURL URLWithString:where]];
}

NSString *_Nullable MVLastOpened(void) {
  return gOpened;
}

/** A board to each viewer kept behind, as viewers side by side read each other's, and it goes with it: a named board outlives its writer until logout. */
NSPasteboard *MVPlaceBoard(void) {
  if (!gBehind) return NSPasteboard.generalPasteboard;
  static NSPasteboard *board;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    board = [NSPasteboard pasteboardWithName:[NSString stringWithFormat:@"dev.appdyno.behind.%d", NSProcessInfo.processInfo.processIdentifier]];
    atexit_b(^{ [board releaseGlobally]; });
  });
  return board;
}

void MVSayCopied(NSButton *button) {
  NSString *before = button.title;
  if ([before isEqual:MVWord(@"Copied")]) return;
  button.title = MVWord(@"Copied");
  MVAnnounce(@"Copied");
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kCopiedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    button.title = before;
  });
}

NSString *MVSaid(NSDictionary *said) {
  return ([NSLocale.preferredLanguages.firstObject hasPrefix:@"tr"] ? said[@"tr"] : said[@"en"]) ?: @"";
}
