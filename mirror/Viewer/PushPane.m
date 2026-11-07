// The Push pane: a push to an app by `push`, the op an agent calls. Which types the device takes, how each goes, the
// fields each takes and the payload to start from are the op's: the pane shows them, and sends what a person fills in.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10, kPayloadHigh = 150;
/// The fields a type may take, in the order they stand, by the op's names.
static NSString *const kFields[] = {@"title", @"body", @"image", @"data"};
enum { kFieldCount = sizeof kFields / sizeof kFields[0] };

/// A type as a person reads it: `live_activity` is Live Activity.
static NSString *typeTitle(NSString *type) {
  return MVWord([type stringByReplacingOccurrencesOfString:@"_" withString:@" "].capitalizedString);
}

/// `key=value` a line, as the op takes them: keys to strings.
static NSDictionary<NSString *, NSString *> *dataOf(NSString *text) {
  NSMutableDictionary *data = [NSMutableDictionary dictionary];
  for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSRange equals = [line rangeOfString:@"="];
    NSString *key = [(equals.location == NSNotFound ? line : [line substringToIndex:equals.location]) stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (key.length) data[key] = equals.location == NSNotFound ? @"" : [line substringFromIndex:NSMaxRange(equals)];
  }
  return data;
}

/// The op's template as a person edits it: one key a line.
static NSString *readable(NSString *json) {
  id parsed = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:NULL];
  NSData *pretty = parsed ? [NSJSONSerialization dataWithJSONObject:parsed options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys | NSJSONWritingWithoutEscapingSlashes error:NULL] : nil;
  return pretty ? [[NSString alloc] initWithData:pretty encoding:NSUTF8StringEncoding] : json;
}

@implementation MVPushPane {
  NSTextField *_app, *_how;
  NSString *_suggested, *_template;
  NSPopUpButton *_type;
  NSArray<MVAccentButton *> *_modes;
  NSGridView *_fields;
  NSDictionary<NSString *, NSTextField *> *_inputs;
  NSView *_payloadCard;
  NSTextView *_payload;
  MVAccentButton *_send;
  BOOL _raw;
}

@synthesize onSend = _onSend, answer = _answer;

- (NSTextField *)input:(NSString *)name placeholder:(NSString *)placeholder label:(NSString *)label {
  NSTextField *field = [NSTextField textFieldWithString:@""];
  field.identifier = [@"push:" stringByAppendingString:name];
  field.placeholderString = MVWord(placeholder);
  field.accessibilityLabel = MVWord(label);
  // Return sends, and leaving the field does not
  field.cell.sendsActionOnEndEditing = NO;
  field.target = self;
  field.action = @selector(sendPush:);
  return field;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _app = [self input:@"app" placeholder:@"The app's id" label:@"App"];
    _type = [NSPopUpButton new];
    _type.identifier = @"pushType";
    _type.autoenablesItems = NO;
    _type.target = self;
    _type.action = @selector(typeChosen:);
    _type.accessibilityLabel = MVWord(@"Type of push");
    _how = MVPaneNote(@"Asking the device what it takes");
    NSMutableArray<MVAccentButton *> *modes = [NSMutableArray array];
    [@[@"Fields", @"Payload"] enumerateObjectsUsingBlock:^(NSString *word, NSUInteger at, BOOL *stop) {
      MVAccentButton *mode = (MVAccentButton *)MVPlaceButton(word, [NSString stringWithFormat:@"pushMode:%lu", (unsigned long)at], self, @selector(modeChosen:));
      mode.tag = (NSInteger)at;
      [modes addObject:mode];
    }];
    _modes = modes;
    NSStackView *mode = [NSStackView stackViewWithViews:modes];
    mode.spacing = 6;
    mode.accessibilityLabel = MVWord(@"What is sent");
    _inputs = @{
      @"title": [self input:@"title" placeholder:@"Order 42" label:@"Title"],
      @"body": [self input:@"body" placeholder:@"It has shipped" label:@"Body"],
      @"image": [self input:@"image" placeholder:@"A link, or a file on this Mac" label:@"Image"],
      @"data": [self input:@"data" placeholder:@"key=value, a line each" label:@"Data"],
    };
    // lines of their own, by Option-Return: inbox and messaging take a line each
    for (NSString *name in @[@"body", @"data"]) _inputs[name].usesSingleLineMode = NO;
    NSMutableArray *rows = [NSMutableArray array];
    for (int i = 0; i < kFieldCount; i++) [rows addObject:@[MVText(_inputs[kFields[i]].accessibilityLabel, MVStyleStrong), MVFieldPlate(_inputs[kFields[i]], nil)]];
    _fields = [NSGridView gridViewWithViews:rows];
    _fields.rowSpacing = 6;
    _fields.columnSpacing = 8;
    [_fields columnAtIndex:0].xPlacement = NSGridCellPlacementTrailing;
    NSScrollView *scroll = [NSTextView scrollableTextView];
    scroll.drawsBackground = NO;
    _payload = scroll.documentView;
    _payload.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
    _payload.textColor = MVInkColor();
    _payload.drawsBackground = NO;
    _payload.richText = NO;
    // JSON's own quotes: a curly one is no JSON
    _payload.automaticQuoteSubstitutionEnabled = _payload.automaticDashSubstitutionEnabled = _payload.automaticTextReplacementEnabled = NO;
    _payload.accessibilityLabel = MVWord(@"Payload, as JSON");
    [scroll.heightAnchor constraintEqualToConstant:kPayloadHigh].active = YES;
    _payloadCard = MVCard(scroll, 6);
    _payloadCard.hidden = YES;
    _send = MVPlacePrimary(@"Send", @"pushGo", self, @selector(sendPush:));
    _send.accessibilityLabel = MVControlTitle(@"push");
    _send.enabled = NO;
    _answer = [MVAnswerView new];
    NSStackView *stack = [NSStackView stackViewWithViews:@[MVFieldPlate(_app, nil), _type, _how, mode, _fields, _payloadCard, _send, _answer]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 6;
    for (NSView *view in @[stack.arrangedSubviews[0], _type, _how, _fields, _payloadCard, _answer]) [view.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:_how];
    [stack setCustomSpacing:kBetween afterView:_send];
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
      [stack.topAnchor constraintEqualToAnchor:self.topAnchor],
      [stack.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [stack.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
    [self showMode];
  }
  return self;
}

/// What this device takes, and the app in front, asked again each time: either may have changed.
- (void)ask {
  MVPaneSend(self, @{@"op": @"control", @"name": @"pushes"});
}

- (void)focus {
  [self.window makeFirstResponder:_app.stringValue.length ? _inputs[@"title"] : _app];
}

- (nullable NSDictionary *)chosen {
  return _type.selectedItem.representedObject;
}

- (void)show:(NSDictionary *)m {
  if ([m[@"types"] isKindOfClass:NSArray.class]) [self list:m[@"types"]];
  // the app in front, unless a person has put another
  if ([m[@"app"] isKindOfClass:NSString.class] && (!_app.stringValue.length || [_app.stringValue isEqual:_suggested])) _app.stringValue = _suggested = m[@"app"];
  [_answer show:m];
  _send.enabled = self.chosen[@"route"] && !_answer.waiting;
}

- (void)list:(NSArray<NSDictionary *> *)types {
  NSString *was = self.chosen[@"type"];
  [_type removeAllItems];
  for (NSDictionary *entry in types) {
    if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"type"] isKindOfClass:NSString.class]) continue;
    [_type addItemWithTitle:typeTitle(entry[@"type"])];
    NSMenuItem *item = _type.lastItem;
    item.representedObject = entry;
    item.enabled = entry[@"route"] != nil;
    item.toolTip = entry[@"why"];
  }
  // the type chosen before if it is still taken, else the first that is
  NSInteger first = -1, same = -1;
  for (NSInteger i = 0; i < _type.numberOfItems; i++) {
    NSMenuItem *item = [_type itemAtIndex:i];
    if (!item.enabled) continue;
    if (first < 0) first = i;
    if ([item.representedObject[@"type"] isEqual:was]) same = i;
  }
  NSInteger keep = same >= 0 ? same : first;
  if (keep >= 0) [_type selectItemAtIndex:keep];
  [self typeChosen:nil];
}

/// The fields the type takes, how it goes or why not, and its payload to start from where a person has not changed it.
- (void)typeChosen:(nullable id)sender {
  NSDictionary *entry = self.chosen;
  _how.stringValue = MVWord(entry[@"route"] ?: entry[@"why"] ?: @"");
  NSArray *takes = [entry[@"fields"] isKindOfClass:NSArray.class] ? entry[@"fields"] : @[];
  for (int i = 0; i < kFieldCount; i++) [_fields rowAtIndex:i].hidden = ![takes containsObject:kFields[i]];
  if ([entry[@"template"] isKindOfClass:NSString.class] && (!_payload.string.length || [_payload.string isEqual:_template])) _payload.string = _template = readable(entry[@"template"]);
  _send.enabled = entry[@"route"] && !_answer.waiting;
}

- (void)fill:(NSDictionary<NSString *, NSString *> *)fields {
  for (NSInteger i = 0; i < _type.numberOfItems; i++)
    if ([[_type itemAtIndex:i].representedObject[@"type"] isEqual:fields[@"type"]]) [_type selectItemAtIndex:i];
  [self typeChosen:nil];
  for (NSString *name in _inputs) _inputs[name].stringValue = fields[name] ?: @"";
  if (fields[@"app"]) _app.stringValue = fields[@"app"];
}

- (void)modeChosen:(NSButton *)sender {
  _raw = sender.tag == 1;
  [self showMode];
}

- (void)showMode {
  for (MVAccentButton *mode in _modes) {
    mode.hue = (mode.tag == 1) == _raw ? MVAccent() : nil;
    mode.accessibilityValue = (mode.tag == 1) == _raw ? MVWord(@"selected") : nil;
  }
  _fields.hidden = _raw;
  _payloadCard.hidden = !_raw;
}

/// What the type takes, filled: a payload replaces the fields, as the op has it.
- (void)sendPush:(id)sender {
  NSDictionary *entry = self.chosen;
  if (!entry[@"route"] || _answer.waiting) return;
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:entry[@"type"] forKey:@"type"];
  NSString *app = [_app.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (app.length) args[@"app"] = app;
  if (_raw) args[@"payload"] = _payload.string;
  for (NSString *name in _raw ? @[] : entry[@"fields"]) {
    NSString *value = _inputs[name].stringValue;
    if (!value.length) continue;
    args[name] = [name isEqual:@"data"] ? dataOf(value) : value;
  }
  _send.enabled = NO;
  [_answer sending:MVFormat(@"Sending %@", @[_type.titleOfSelectedItem ?: @""])];
  MVPaneSend(self, @{@"op": @"control", @"name": @"push", @"args": args});
}

@end
