// The Links pane: a link a person types goes to the device by `open_link`, the op an agent calls, and the answer comes
// back as it comes, a refusal and what to do about it too. The parent keeps the links opened, for each device.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10;

@implementation MVLinkPane {
  NSTextField *_field, *_app;
  NSString *_suggested;
  MVAccentButton *_open;
  MVList *_recent;
  NSView *_none;
}

@synthesize onSend = _onSend, answer = _answer;

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _field = MVSendField(@"linkField", @"https://… or yourapp://…", @"Link to open", self, @selector(open:));
    _field.usesSingleLineMode = YES;
    _field.lineBreakMode = NSLineBreakByTruncatingMiddle;
    // an iPhone opens a link only in a named app; elsewhere none lets the system choose
    _app = MVSendField(@"linkApp", @"Any app, or one app's id", @"App to open it in", self, @selector(open:));
    _open = MVPlacePrimary(@"Open", @"openLinkGo", self, @selector(open:));
    _open.accessibilityLabel = MVControlTitle(@"openLink");
    NSStackView *ask = [NSStackView stackViewWithViews:@[MVFieldPlate(_field, nil), _open]];
    ask.spacing = 8;
    _answer = [MVAnswerView new];
    _none = MVEmptyCard(@"clock.arrow.circlepath", @"Links opened here stay, for this device.");
    NSStackView *stack = [NSStackView stackViewWithViews:@[ask, MVFieldPlate(_app, nil), MVPaneNote(@"Any scheme: a web link, a universal link or App Link, or the app's own."), _answer, _none]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeWidth;
    stack.spacing = 6;
    [stack setCustomSpacing:kBetween afterView:_answer];
    _recent = [MVList new];
    _recent.accessibilityLabel = MVWord(@"Recent links");
    _recent.hidden = YES;
    __weak MVLinkPane *weak = self;
    _recent.onSelect = ^(MVRow *row) {
      if (row) [weak fill:row.key app:nil];
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

/// The recent links, and the app in front, asked again each time: the app may have changed.
- (void)ask {
  MVPaneSend(self, @{@"op": @"control", @"name": @"links"});
}

- (void)focus {
  [self.window makeFirstResponder:_field];
}

- (void)fill:(NSString *)url app:(nullable NSString *)app {
  _field.stringValue = url;
  if (app) _app.stringValue = app;
  [self focus];
}

/// One at a time: a second would race the first for what the pane says.
- (void)open:(id)sender {
  NSString *url = [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!url.length || _answer.waiting) return;
  _open.enabled = NO;
  [_answer sending:MVFormat(@"Opening %@", @[url])];
  NSString *app = [_app.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  MVPaneSend(self, @{@"op": @"control", @"name": @"openLink", @"url": url, @"app": app});
}

- (void)show:(NSDictionary *)m {
  if ([m[@"recent"] isKindOfClass:NSArray.class]) [self list:m[@"recent"]];
  // the app in front, unless a person has put another
  if ([m[@"app"] isKindOfClass:NSString.class] && (!_app.stringValue.length || [_app.stringValue isEqual:_suggested])) _app.stringValue = _suggested = m[@"app"];
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
