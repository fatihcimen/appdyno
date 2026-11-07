// The Links pane: a link a person types goes to the device by `open_link`, the op an agent calls, and the answer comes
// back as it comes, a refusal and what to do about it too. The parent keeps the links opened, for each device.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10, kMark = 13, kSlide = 8;
// the Inspector's words, less the mark beside them
static const double kWordsWide = 264;

@implementation MVLinkPane {
  NSTextField *_field, *_words, *_what;
  MVAccentButton *_open;
  MVInk *_mark;
  NSStackView *_answer;
  MVList *_recent;
  NSView *_none;
  BOOL _asked;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _field = [NSTextField textFieldWithString:@""];
    _field.identifier = @"linkField";
    _field.placeholderString = MVWord(@"https://… or yourapp://…");
    _field.accessibilityLabel = MVWord(@"Link to open");
    _field.usesSingleLineMode = YES;
    _field.lineBreakMode = NSLineBreakByTruncatingMiddle;
    // Return opens it, and leaving the field does not
    _field.cell.sendsActionOnEndEditing = NO;
    _field.target = self;
    _field.action = @selector(open:);
    _open = MVPlacePrimary(@"Open", @"openLinkGo", self, @selector(open:));
    _open.accessibilityLabel = MVControlTitle(@"openLink");
    NSStackView *ask = [NSStackView stackViewWithViews:@[MVFieldPlate(_field, nil), _open]];
    ask.spacing = 8;
    _mark = [[MVInk alloc] initWithSymbol:@"link" color:MVQuietColor() size:kMark];
    _words = [self wrapped:MVStyleBody];
    _what = [self wrapped:MVStyleSub];
    NSStackView *lines = [NSStackView stackViewWithViews:@[_words, _what]];
    lines.orientation = NSUserInterfaceLayoutOrientationVertical;
    lines.alignment = NSLayoutAttributeLeading;
    lines.spacing = 2;
    // the mark keeps its width, and the words take the rest
    [_mark.widthAnchor constraintEqualToConstant:kMark + 4].active = YES;
    [lines setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _answer = [NSStackView stackViewWithViews:@[_mark, lines]];
    _answer.alignment = NSLayoutAttributeTop;
    _answer.hidden = YES;
    _none = MVEmptyCard(@"clock.arrow.circlepath", @"Links opened here stay, for this device.");
    NSStackView *stack = [NSStackView stackViewWithViews:@[ask, MVPaneNote(@"Any scheme: a web link, a universal link or App Link, or the app's own."), _answer, _none]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeWidth;
    stack.spacing = 6;
    [stack setCustomSpacing:kBetween afterView:_answer];
    _recent = [MVList new];
    _recent.accessibilityLabel = MVWord(@"Recent links");
    _recent.hidden = YES;
    __weak MVLinkPane *weak = self;
    _recent.onSelect = ^(MVRow *row) {
      if (row) [weak fill:row.key];
    };
    // the list takes what room is left under the rest
    for (NSView *part in @[stack, _recent]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
      [part.leadingAnchor constraintEqualToAnchor:self.leadingAnchor].active = YES;
      [part.trailingAnchor constraintEqualToAnchor:self.trailingAnchor].active = YES;
    }
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor],
      [_recent.topAnchor constraintEqualToAnchor:stack.bottomAnchor constant:kBetween],
      [_recent.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
    ]];
  }
  return self;
}

/// Words that wrap to as many lines as they take: a refusal is never cut short.
- (NSTextField *)wrapped:(MVStyle)style {
  NSTextField *field = MVWrappedText(@"", style);
  field.maximumNumberOfLines = 0;
  field.preferredMaxLayoutWidth = kWordsWide;
  field.selectable = YES;
  return field;
}

- (void)send:(NSDictionary *)message {
  if (self.onSend) return self.onSend(message);
  MVEmitFrom(self, message);
}

- (void)ask {
  if (_asked) return;
  _asked = YES;
  [self send:@{@"op": @"control", @"name": @"links"}];
}

- (void)focus {
  [self.window makeFirstResponder:_field];
}

- (void)fill:(NSString *)url {
  _field.stringValue = url;
  [self focus];
}

/// One at a time: a second would race the first for what the pane says.
- (void)open:(id)sender {
  NSString *url = [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!url.length || !_open.enabled) return;
  _open.enabled = NO;
  [self say:MVFormat(@"Opening %@", @[url]) what:@"" symbol:@"arrow.up.forward.circle" color:MVQuietColor()];
  [self send:@{@"op": @"control", @"name": @"openLink", @"url": url}];
}

- (void)say:(NSString *)words what:(NSString *)what symbol:(NSString *)symbol color:(NSColor *)color {
  _answer.hidden = NO;
  [_mark paint:symbol color:color];
  _words.stringValue = words;
  _what.stringValue = what;
  _what.hidden = !what.length;
}

- (void)show:(NSDictionary *)m {
  if ([m[@"recent"] isKindOfClass:NSArray.class]) [self list:m[@"recent"]];
  if (m[@"line"] && !_open.enabled) [self say:MVWord(m[@"line"]) what:@"" symbol:@"arrow.up.forward.circle" color:MVQuietColor()];
  if (!m[@"ok"]) return;
  BOOL ok = [m[@"ok"] boolValue];
  _open.enabled = YES;
  // a state has its symbol and its words as well as its colour
  [self say:MVWord(m[@"text"] ?: @"") what:MVWord(m[@"hint"] ?: @"") symbol:ok ? @"checkmark.circle.fill" : @"exclamationmark.triangle.fill" color:ok ? MVGreen() : MVRed()];
  MVSlideIn(_answer, kSlide);
  MVAnnounce(_what.stringValue.length ? [NSString stringWithFormat:@"%@. %@", _words.stringValue, _what.stringValue] : _words.stringValue);
}

- (void)list:(NSArray *)links {
  NSMutableArray<MVRow *> *rows = [NSMutableArray arrayWithObject:[MVRow headerNamed:MVWord(@"Recent")]];
  for (NSString *link in links) {
    if (![link isKindOfClass:NSString.class]) continue;
    MVRow *row = [MVRow new];
    row.title = link;
    row.detail = [link componentsSeparatedByString:@":"].firstObject;
    row.symbol = @"link";
    row.key = link;
    [rows addObject:row];
  }
  _recent.rows = rows;
  [_recent selectKey:nil];
  _recent.hidden = rows.count < 2;
  _none.hidden = !_recent.hidden;
}

- (NSString *)said {
  return _answer.hidden ? @"" : _words.stringValue;
}

- (NSString *)hint {
  return _what.stringValue;
}

- (NSArray<MVRow *> *)rows {
  return _recent.rows;
}

@end
