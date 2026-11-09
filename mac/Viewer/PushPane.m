// The Push pane: a push to an app by `push`, the op an agent calls. Which types the device takes, how each goes, the
// fields each takes and the payload to start from are the op's: the pane shows them, and sends what a person fills in.
// Where a route goes by a token a person may type, a token typed here goes to the parent alone, never to an op.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kBetween = 10, kPayloadHigh = 150;
/// The fields a type may take, in the order they stand, by the op's names.
static NSString *const kFields[] = {@"title", @"body", @"image", @"data"};
enum { kFieldCount = sizeof kFields / sizeof kFields[0] };
/// The kinds of token, by the op's names, as a person reads them.
static NSString *const kKinds[][2] = {{@"device", @"Device"}, {@"activity", @"Activity"}, {@"start", @"Push to Start"}, {@"voip", @"VoIP"}, {@"widget", @"Widget"}};

/// A type as a person reads it: `live_activity` is Live Activity.
static NSString *typeTitle(NSString *type) {
  return MVWord([type stringByReplacingOccurrencesOfString:@"_" withString:@" "].capitalizedString);
}

/// What a type does, as a person reads it: the op says how it goes on this device, in its own words, under the pointer.
static NSString *typeWords(NSString *type) {
  NSDictionary<NSString *, NSString *> *words = @{
    @"alert": @"A notification a person sees, with a title and a body",
    @"background": @"No notification: the data goes to the app's own code",
    @"rich": @"A notification with an image",
    @"live_activity": @"Starts, updates or ends a Live Activity",
    @"tapped": @"As if a notification was tapped: the app opens with its data",
    @"voip": @"A call coming in, for an app that rings",
    @"widgets": @"Asks the app's widgets to load again",
  };
  return words[type] ?: @"";
}

/// A kind of token in English, where the table has it.
static NSString *kindTitle(NSString *kind) {
  for (size_t i = 0; i < sizeof kKinds / sizeof kKinds[0]; i++)
    if ([kKinds[i][0] isEqual:kind]) return kKinds[i][1];
  return kind;
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

@interface MVPushPane () <NSTextFieldDelegate>
@end

@implementation MVPushPane {
  NSTextField *_app, *_how, *_token, *_tokenNote;
  NSString *_suggested, *_template;
  NSPopUpButton *_type, *_kind;
  NSArray<MVAccentButton *> *_modes;
  NSGridView *_fields;
  NSDictionary<NSString *, NSTextField *> *_inputs;
  NSView *_payloadCard, *_tokenCard;
  NSTextView *_payload;
  MVAccentButton *_send;
  BOOL _raw;
}

@synthesize onSend = _onSend, answer = _answer;

/// A token for the app in the field, of a kind to choose, and what becomes of it, said before it is typed.
- (NSView *)tokenCard {
  _token = MVSecretField(@"push:token", @"Push token", @"Push token", self, @selector(keepToken:));
  _kind = [NSPopUpButton new];
  _kind.identifier = @"pushTokenKind";
  _kind.target = self;
  _kind.action = @selector(sayToken);
  _kind.accessibilityLabel = MVWord(@"Kind of token");
  NSButton *keep = MVPlaceButton(@"Keep", @"pushTokenGo", self, @selector(keepToken:));
  keep.accessibilityLabel = MVWord(@"Keep push token");
  NSStackView *field = [NSStackView stackViewWithViews:@[MVFieldPlate(_token, nil), keep]];
  field.spacing = 8;
  _tokenNote = MVPaneNote(@"");
  MVHoldContent(_tokenNote);
  NSStackView *card = [NSStackView stackViewWithViews:@[_kind, field, _tokenNote]];
  card.orientation = NSUserInterfaceLayoutOrientationVertical;
  card.alignment = NSLayoutAttributeLeading;
  card.spacing = 6;
  for (NSView *view in card.arrangedSubviews) [view.widthAnchor constraintEqualToAnchor:card.widthAnchor].active = YES;
  card.hidden = YES;
  return card;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _app = MVSendField(@"push:app", @"The app's id", @"App", self, @selector(sendPush:));
    _app.delegate = self;
    _type = [NSPopUpButton new];
    _type.identifier = @"pushType";
    _type.autoenablesItems = NO;
    _type.target = self;
    _type.action = @selector(typeChosen:);
    _type.accessibilityLabel = MVWord(@"Type of push");
    _how = MVPaneNote(@"Asking the device what it takes");
    // why a type cannot go may take more lines than a note's three, in Turkish the more
    _how.maximumNumberOfLines = 0;
    NSMutableArray<MVAccentButton *> *modes = [NSMutableArray array];
    [@[@"Fields", @"Payload"] enumerateObjectsUsingBlock:^(NSString *word, NSUInteger at, __unused BOOL *stop) {
      MVAccentButton *mode = (MVAccentButton *)MVPlaceButton(word, [NSString stringWithFormat:@"pushMode:%lu", (unsigned long)at], self, @selector(modeChosen:));
      mode.tag = (NSInteger)at;
      [modes addObject:mode];
    }];
    _modes = modes;
    NSStackView *mode = [NSStackView stackViewWithViews:modes];
    mode.spacing = 6;
    mode.accessibilityLabel = MVWord(@"What is sent");
    _inputs = @{
      @"title": MVSendField(@"push:title", @"Order 42", @"Title", self, @selector(sendPush:)),
      @"body": MVSendField(@"push:body", @"It has shipped", @"Body", self, @selector(sendPush:)),
      @"image": MVSendField(@"push:image", @"A link, or a file on this Mac", @"Image", self, @selector(sendPush:)),
      @"data": MVSendField(@"push:data", @"key=value, a line each", @"Data", self, @selector(sendPush:)),
    };
    // lines of their own, by Option-Return: a body may run to lines, and data takes a key a line
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
    _tokenCard = [self tokenCard];
    NSStackView *stack = [NSStackView stackViewWithViews:@[MVFieldPlate(_app, nil), _type, _how, _tokenCard, mode, _fields, _payloadCard, _send, _answer]];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.alignment = NSLayoutAttributeLeading;
    stack.spacing = 6;
    for (NSView *view in @[stack.arrangedSubviews[0], _type, _how, _tokenCard, _fields, _payloadCard, _answer]) [view.widthAnchor constraintEqualToAnchor:stack.widthAnchor].active = YES;
    [stack setCustomSpacing:kBetween afterView:_how];
    [stack setCustomSpacing:kBetween afterView:_tokenCard];
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

/// What this device takes for the app a person named, else the one in front, and that one, asked again each time: any
/// may have changed, and an app's build may take other routes.
- (void)ask {
  NSString *app = self.appNamed;
  MVPaneSend(self, app.length && ![app isEqual:_suggested] ? @{@"op": @"control", @"name": @"pushes", @"app": app} : @{@"op": @"control", @"name": @"pushes"});
}

/// Another app named, once a person is done with it.
- (void)controlTextDidEndEditing:(NSNotification *)note {
  if (note.object == _app) [self ask];
}

- (void)focus {
  [self.window makeFirstResponder:_app.stringValue.length ? _inputs[@"title"] : _app];
}

- (nullable NSDictionary *)chosen {
  return _type.selectedItem.representedObject;
}

- (void)show:(NSDictionary *)m {
  // the app in front, unless a person has put another
  if ([m[@"app"] isKindOfClass:NSString.class] && (!_app.stringValue.length || [_app.stringValue isEqual:_suggested])) _app.stringValue = _suggested = m[@"app"];
  if ([m[@"types"] isKindOfClass:NSArray.class]) [self list:m[@"types"]];
  [_answer show:m];
  _send.enabled = self.chosen[@"route"] && !_answer.waiting;
}

- (void)list:(NSArray<NSDictionary *> *)types {
  NSString *was = self.chosen[@"type"];
  [_type removeAllItems];
  NSMutableOrderedSet<NSString *> *kinds = [NSMutableOrderedSet orderedSet];
  for (NSDictionary *entry in types) {
    if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"type"] isKindOfClass:NSString.class]) continue;
    [_type addItemWithTitle:typeTitle(entry[@"type"])];
    NSMenuItem *item = _type.lastItem;
    item.representedObject = entry;
    item.enabled = entry[@"route"] != nil;
    item.toolTip = entry[@"why"];
    for (id kind in [entry[@"tokens"] isKindOfClass:NSArray.class] ? entry[@"tokens"] : @[])
      if ([kind isKindOfClass:NSString.class]) [kinds addObject:kind];
  }
  // the kinds of token the routes go by: none until a person sets APNs or FCM up for this device
  [_kind removeAllItems];
  for (NSString *kind in kinds) {
    [_kind addItemWithTitle:MVWord(kindTitle(kind))];
    _kind.lastItem.representedObject = kind;
  }
  _tokenCard.hidden = kinds.count == 0;
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
  NSString *words = entry[@"route"] ? typeWords(entry[@"type"]) : @"";
  NSString *plain = entry[@"route"] ?: (entry[@"why"] ?: @"");
  _how.stringValue = MVWord(words.length ? words : plain);
  _how.toolTip = words.length ? entry[@"route"] : nil;
  NSArray *takes = [entry[@"fields"] isKindOfClass:NSArray.class] ? entry[@"fields"] : @[];
  for (int i = 0; i < kFieldCount; i++) [_fields rowAtIndex:i].hidden = ![takes containsObject:kFields[i]];
  if ([entry[@"template"] isKindOfClass:NSString.class] && (!_payload.string.length || [_payload.string isEqual:_template])) _payload.string = _template = readable(entry[@"template"]);
  _send.enabled = entry[@"route"] && !_answer.waiting;
  // the token this type goes by first
  if ([entry[@"tokens"] isKindOfClass:NSArray.class]) [self chooseKind:[entry[@"tokens"] firstObject]];
  [self sayToken];
}

- (void)fill:(NSDictionary<NSString *, NSString *> *)fields {
  if (fields[@"app"]) _app.stringValue = fields[@"app"];
  for (NSInteger i = 0; i < _type.numberOfItems; i++)
    if ([[_type itemAtIndex:i].representedObject[@"type"] isEqual:fields[@"type"]]) [_type selectItemAtIndex:i];
  [self typeChosen:nil];
  for (NSString *name in _inputs) _inputs[name].stringValue = fields[name] ?: @"";
  if (fields[@"kind"]) [self chooseKind:fields[@"kind"]];
  [self sayToken];
  _token.stringValue = fields[@"token"] ?: @"";
}

- (void)chooseKind:(nullable NSString *)kind {
  NSInteger at = kind ? [_kind indexOfItemWithRepresentedObject:kind] : -1;
  if (at >= 0) [_kind selectItemAtIndex:at];
}

- (NSString *)appNamed {
  return [_app.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
}

/// Another app named: the token typed is for it.
- (void)controlTextDidChange:(NSNotification *)note {
  [self sayToken];
}

/// What becomes of a token typed here, said before it is: whose it is, which, and for how long.
- (void)sayToken {
  NSString *app = self.appNamed, *kind = _kind.selectedItem.representedObject;
  // the app's id is its own
  _tokenNote.stringValue = app.length && kind ? MVFormat(@"Kept for this session only, as %@'s %@ token", @[app, MVWord(kindTitle(kind))]) : MVWord(@"Kept for this session only, for the app above");
}

/// To the parent alone, and out of the field as it goes: a token is never shown back.
- (void)keepToken:(id)sender {
  NSString *token = [_token.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *kind = _kind.selectedItem.representedObject;
  if (_tokenCard.hidden || !token.length || !kind || _answer.waiting) return;
  _token.stringValue = @"";
  _send.enabled = NO;
  [_answer sending:MVWord(@"Keeping the token")];
  MVPaneSend(self, @{@"op": @"control", @"name": @"pushToken", @"app": self.appNamed, @"token": token, @"kind": kind});
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
  NSString *app = self.appNamed;
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
