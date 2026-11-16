// A rule of the Network pane as fields, each under its name: what it takes, by method, host, path and what else must
// match, and then what it does, an answer with a status and a body, a wait, a failure or another host. Its line stands
// under them for who would rather type it. The parent reads a rule's line into these and writes them as a line, so the
// two never disagree on how a rule is written. A name stands over its field, as Turkish names are the longer ones.
#import "Place.h"
#import "Window.h"
#import "Words.h"

/// The op's word for each choice, and none for the first: any method, and no failure.
static NSString *const kMethods[] = {@"", @"GET", @"POST", @"PUT", @"PATCH", @"DELETE"};
static NSString *const kFails[][2] = {
    {@"", @"None"},
    {@"offline", @"Offline"},
    {@"timeout", @"Timeout"},
    {@"reset", @"Connection Lost"},
};
enum { kMethodCount = sizeof kMethods / sizeof kMethods[0],
       kFailCount = sizeof kFails / sizeof kFails[0] };
static const double kBodyHigh = 64;

NSString *MVNetworkFailWord(NSString *fail) {
  for (NSInteger i = 1; i < kFailCount; i++)
    if ([kFails[i][0] isEqual:fail]) return MVWord(kFails[i][1]);
  return fail;
}

@interface MVNetworkRuleForm () <NSTextFieldDelegate, NSTextViewDelegate>
@end

@implementation MVNetworkRuleForm {
  NSPopUpButton *_method, *_fail;
  NSDictionary<NSString *, NSTextField *> *_texts;
  NSTextView *_body;
  NSTextField *_line;
  NSButton *_asText;
  NSView *_linePlate;
}

/// A control under its name, the two as one column of a row.
static NSView *named(NSString *label, NSView *control) {
  NSTextField *name = MVText(label, MVStyleSub);
  name.lineBreakMode = NSLineBreakByTruncatingTail;
  [name setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  control.accessibilityLabel = MVWord(label);
  NSStackView *column = MVPaneStack(@[name, control], 3);
  [column setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
  return column;
}

- (NSView *)field:(NSString *)key name:(NSString *)name holding:(NSString *)placeholder called:(NSString *)label into:(NSMutableDictionary *)texts {
  NSTextField *field = MVSendField(name, placeholder, label, self, @selector(submitted:));
  field.delegate = self;
  field.usesSingleLineMode = YES;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  field.toolTip = MVWord(placeholder);
  texts[key] = field;
  return named(label, MVFieldPlate(field, nil));
}

- (NSPopUpButton *)choice:(NSString *)name {
  NSPopUpButton *choice = [NSPopUpButton new];
  choice.identifier = name;
  choice.target = self;
  choice.action = @selector(edited:);
  return choice;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _method = [self choice:@"networkRuleMethod"];
    [_method addItemWithTitle:MVWord(@"Any")];
    for (NSInteger i = 1; i < kMethodCount; i++) [_method addItemWithTitle:kMethods[i]];
    _fail = [self choice:@"networkRuleFail"];
    for (NSInteger i = 0; i < kFailCount; i++) [_fail addItemWithTitle:MVWord(kFails[i][1])];
    NSMutableDictionary<NSString *, NSTextField *> *texts = [NSMutableDictionary dictionary];
    NSView *host = [self field:@"host" name:@"networkRuleHost" holding:@"api.example.com" called:@"Host" into:texts];
    NSView *path = [self field:@"path" name:@"networkRulePath" holding:@"/v1/items*" called:@"Path" into:texts];
    NSView *match = [self field:@"match" name:@"networkRuleMatch" holding:@"query=\"page=2\" has=name=Ada when=\"X-Api: 2*\"" called:@"Also Matches" into:texts];
    NSView *status = [self field:@"status" name:@"networkRuleStatus" holding:@"200" called:@"Status" into:texts];
    NSView *delay = [self field:@"delayMs" name:@"networkRuleDelay" holding:@"ms" called:@"Delay" into:texts];
    NSView *to = [self field:@"to" name:@"networkRuleTo" holding:@"staging.example.com" called:@"Send to Another Host" into:texts];
    _texts = texts;
    NSScrollView *scroll = [NSTextView scrollableTextView];
    _body = scroll.documentView;
    _body.identifier = @"networkRuleBody";
    _body.delegate = self;
    _body.richText = NO;
    _body.drawsBackground = NO;
    _body.font = [NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular];
    _body.textColor = MVInkColor();
    _body.insertionPointColor = MVInkColor();
    _body.automaticQuoteSubstitutionEnabled = _body.automaticDashSubstitutionEnabled = _body.automaticSpellingCorrectionEnabled = NO;
    _body.textContainerInset = NSMakeSize(4, 6);
    scroll.drawsBackground = NO;
    scroll.autohidesScrollers = YES;
    NSView *well = MVCardInset(scroll, 1, 1);
    well.layer.cornerRadius = 9;
    [well.heightAnchor constraintEqualToConstant:kBodyHigh].active = YES;
    NSView *body = named(@"Answer Body", well);
    _body.accessibilityLabel = MVWord(@"Answer Body");
    NSStackView *first = [NSStackView stackViewWithViews:@[named(@"Method", _method), host]];
    NSStackView *does = [NSStackView stackViewWithViews:@[status, delay, named(@"Failure", _fail)]];
    for (NSStackView *row in @[first, does]) {
      row.spacing = 8;
      row.alignment = NSLayoutAttributeBottom;
    }
    does.distribution = NSStackViewDistributionFillEqually;
    [_method setContentHuggingPriority:NSLayoutPriorityRequired forOrientation:NSLayoutConstraintOrientationHorizontal];
    // its line, for who would rather type it: out of the way until asked for
    _asText = MVPlaceButton(@"As Text", @"networkRuleAsText", self, @selector(showLine:));
    _line = MVSendField(@"networkRule", @"api.example.com/items* status=503 body=\"{}\"", @"Rule", self, @selector(submitted:));
    _line.usesSingleLineMode = YES;
    _line.lineBreakMode = NSLineBreakByTruncatingTail;
    _line.delegate = self;
    _linePlate = MVFieldPlate(_line, nil);
    _linePlate.hidden = YES;
    NSStackView *disclose = [NSStackView stackViewWithViews:@[_asText, [NSView new]]];
    MVPaneFill(self, @[first, path, match, does, body, to, disclose, _linePlate], 8);
  }
  return self;
}

- (NSDictionary<NSString *, NSString *> *)fields {
  NSMutableDictionary<NSString *, NSString *> *fields = [NSMutableDictionary dictionary];
  [_texts enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSTextField *field, __unused BOOL *stop) {
    NSString *value = [field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (value.length) fields[key] = value;
  }];
  NSString *body = [_body.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (body.length) fields[@"body"] = body;
  NSInteger method = _method.indexOfSelectedItem, fail = _fail.indexOfSelectedItem;
  if (method > 0 && method < kMethodCount) fields[@"method"] = kMethods[method];
  if (fail > 0 && fail < kFailCount) fields[@"fail"] = kFails[fail][0];
  return fields;
}

/// A rule's parts as the parent read them from its line, and that line; nil empties them.
- (void)show:(nullable NSDictionary *)fields line:(nullable NSString *)line {
  [_texts enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSTextField *field, __unused BOOL *stop) {
    field.stringValue = [fields[key] isKindOfClass:NSString.class] ? fields[key] : @"";
  }];
  _body.string = [fields[@"body"] isKindOfClass:NSString.class] ? fields[@"body"] : @"";
  NSInteger method = 0, fail = 0;
  for (NSInteger i = 1; i < kMethodCount; i++)
    if ([kMethods[i] isEqual:fields[@"method"]]) method = i;
  for (NSInteger i = 1; i < kFailCount; i++)
    if ([kFails[i][0] isEqual:fields[@"fail"]]) fail = i;
  [_method selectItemAtIndex:method];
  [_fail selectItemAtIndex:fail];
  _line.stringValue = line ?: @"";
  _typed = NO;
  // a line the parent could read no parts of is shown as its line, to be put right
  if (line.length && !fields.count) self.asText = YES;
}

- (NSString *)line {
  return [_line.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

- (void)setLine:(NSString *)line {
  _line.stringValue = line;
  _typed = YES;
  self.asText = YES;
}

- (BOOL)asText {
  return !_linePlate.hidden;
}

- (void)setAsText:(BOOL)asText {
  _linePlate.hidden = !asText;
  ((MVAccentButton *)_asText).hue = asText ? MVAccent() : nil;
  _asText.accessibilityValue = asText ? MVWord(@"selected") : nil;
}

/// Asked for, the line comes into sight under the fields, where they scroll.
- (void)showLine:(id)sender {
  self.asText = !self.asText;
  if (!self.asText) return;
  [self.superview.superview layoutSubtreeIfNeeded];
  [_linePlate scrollRectToVisible:_linePlate.bounds];
}

/// Which of the two a person changed last is what is saved: the line once it is typed in, the fields once one of them is.
- (void)controlTextDidChange:(NSNotification *)note {
  _typed = note.object == _line;
  if (self.onEdit) self.onEdit();
}

- (void)textDidChange:(NSNotification *)note {
  [self edited:nil];
}

- (void)edited:(id)sender {
  _typed = NO;
  if (self.onEdit) self.onEdit();
}

- (void)submitted:(id)sender {
  if (self.onSubmit) self.onSubmit();
}

@end
