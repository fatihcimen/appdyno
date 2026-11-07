// The Links pane: a link a person types goes to the device by `open_link`, the op an agent calls, and the answer comes
// back as it comes, a refusal and what to do about it too. The parent keeps the links opened, for each device.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10;

@implementation MVLinkPane {
  NSTextField *_field;
  MVAccentButton *_open;
  MVList *_recent;
  NSView *_none;
  BOOL _asked;
}

@synthesize onSend = _onSend, answer = _answer;

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
    _answer = [MVAnswerView new];
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

- (void)ask {
  if (_asked) return;
  _asked = YES;
  MVPaneSend(self, @{@"op": @"control", @"name": @"links"});
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
  if (!url.length || _answer.waiting) return;
  _open.enabled = NO;
  [_answer sending:MVFormat(@"Opening %@", @[url])];
  MVPaneSend(self, @{@"op": @"control", @"name": @"openLink", @"url": url});
}

- (void)show:(NSDictionary *)m {
  if ([m[@"recent"] isKindOfClass:NSArray.class]) [self list:m[@"recent"]];
  [_answer show:m];
  _open.enabled = !_answer.waiting;
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

- (NSArray<MVRow *> *)rows {
  return _recent.rows;
}

@end
