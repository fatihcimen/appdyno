// What a send pane asks of the parent, and what an op answered it as it comes: a line of progress while it runs, then what
// it did, or why not and what to do. The words are the op's own, as an agent reads them, and nothing of a refusal is cut.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kMark = 13, kSlide = 8;
// the Inspector's words, less the mark beside them
static const double kWordsWide = 264;
static NSString *const kSending = @"arrow.up.forward.circle";

/// Words that wrap to as many lines as they take, and can be selected to copy.
static NSTextField *wrapped(MVStyle style) {
  NSTextField *field = MVWrappedText(@"", style);
  field.maximumNumberOfLines = 0;
  field.preferredMaxLayoutWidth = kWordsWide;
  field.selectable = YES;
  // an answer names a link, an app or a token's kind as the op does: its words are said by what is shown, and kept
  MVHoldContent(field);
  return field;
}

static NSTextField *sendField(Class kind, NSString *name, NSString *placeholder, NSString *label, id target, SEL action) {
  NSTextField *field = [kind textFieldWithString:@""];
  field.identifier = name;
  field.placeholderString = MVWord(placeholder);
  field.accessibilityLabel = MVWord(label);
  field.cell.sendsActionOnEndEditing = NO;
  field.target = target;
  field.action = action;
  return field;
}

NSTextField *MVSendField(NSString *name, NSString *placeholder, NSString *label, id target, SEL action) {
  return sendField(NSTextField.class, name, placeholder, label, target, action);
}

NSSecureTextField *MVSecretField(NSString *name, NSString *placeholder, NSString *label, id target, SEL action) {
  return (NSSecureTextField *)sendField(NSSecureTextField.class, name, placeholder, label, target, action);
}

void MVPaneSend(NSView<MVAsks> *pane, NSDictionary *message) {
  if (pane.onSend) return pane.onSend(message);
  MVEmitFrom(pane, message);
}

void MVPaneWatch(NSView<MVAsks> *pane, NSString *name, BOOL on, NSString *_Nullable level) {
  NSMutableDictionary *message = [@{@"op": @"paneWatch",
                                    @"pane": name,
                                    @"on": @(on)} mutableCopy];
  if (level) message[@"level"] = level;
  MVPaneSend(pane, message);
}

NSStackView *MVPaneStack(NSArray<NSView *> *views, CGFloat spacing) {
  NSStackView *stack = [NSStackView stackViewWithViews:views];
  stack.orientation = NSUserInterfaceLayoutOrientationVertical;
  stack.alignment = NSLayoutAttributeWidth;
  stack.spacing = spacing;
  // each takes the column's width, words and a control too, which keep to their own and stand off its edge otherwise; as a
  // view's own priority, it outlasts a hidden view's leaving the column and coming back
  for (NSView *view in views) {
    [view setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    // a row of its own hugs by the stack's priority, not the view's
    if ([view isKindOfClass:NSStackView.class]) [(NSStackView *)view setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  }
  return stack;
}

NSStackView *MVPaneRow(NSArray<NSView *> *views) {
  NSStackView *row = [NSStackView stackViewWithViews:views];
  row.distribution = NSStackViewDistributionFillEqually;
  row.spacing = 6;
  // a capsule keeps to its words otherwise, and the row stands short of the pane's edge
  for (NSView *view in views) [view setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  return row;
}

NSStackView *MVPaneFill(NSView *pane, NSArray<NSView *> *views, CGFloat spacing) {
  NSStackView *stack = MVPaneStack(views, spacing);
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [pane addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.topAnchor constraintEqualToAnchor:pane.topAnchor],
    [stack.bottomAnchor constraintEqualToAnchor:pane.bottomAnchor],
    [stack.leadingAnchor constraintEqualToAnchor:pane.leadingAnchor],
    [stack.trailingAnchor constraintEqualToAnchor:pane.trailingAnchor],
  ]];
  return stack;
}

@implementation MVAnswerView {
  NSTextField *_words, *_what;
  MVInk *_mark;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _mark = [[MVInk alloc] initWithSymbol:kSending color:MVQuietColor() size:kMark];
    _words = wrapped(MVStyleBody);
    _what = wrapped(MVStyleSub);
    NSStackView *lines = [NSStackView stackViewWithViews:@[_words, _what]];
    lines.orientation = NSUserInterfaceLayoutOrientationVertical;
    lines.alignment = NSLayoutAttributeLeading;
    lines.spacing = 2;
    // the mark keeps its width, and the words take the rest
    [_mark.widthAnchor constraintEqualToConstant:kMark + 4].active = YES;
    [lines setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    [self addArrangedSubview:_mark];
    [self addArrangedSubview:lines];
    self.alignment = NSLayoutAttributeTop;
    self.hidden = YES;
  }
  return self;
}

- (void)say:(NSString *)words what:(NSString *)what symbol:(NSString *)symbol color:(NSColor *)color {
  self.hidden = NO;
  [_mark paint:symbol color:color];
  _words.stringValue = words;
  _what.stringValue = what;
  _what.hidden = !what.length;
}

- (void)sending:(NSString *)words {
  _waiting = YES;
  [self say:words what:@"" symbol:kSending color:MVQuietColor()];
}

- (void)show:(NSDictionary *)m {
  if (m[@"line"] && _waiting) [self say:MVSentence(m[@"line"]) what:@"" symbol:kSending color:MVQuietColor()];
  if (!m[@"ok"]) return;
  _waiting = NO;
  BOOL ok = [m[@"ok"] boolValue];
  // a state has its symbol and its words as well as its colour
  [self say:MVSentence(m[@"text"] ?: @"") what:MVSentence(m[@"hint"] ?: @"") symbol:ok ? @"checkmark.circle.fill" : @"exclamationmark.triangle.fill" color:ok ? MVGreen() : MVRed()];
  MVSlideIn(self, kSlide);
  MVAnnounce(_what.stringValue.length ? [NSString stringWithFormat:@"%@. %@", _words.stringValue, _what.stringValue] : _words.stringValue);
}

- (NSString *)said {
  return self.hidden ? @"" : _words.stringValue;
}

- (NSString *)hint {
  return _what.stringValue;
}

@end
