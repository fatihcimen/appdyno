// A rule of the Network pane as fields, beside its line: what it takes, by method, host, path and what else must
// match, and then what it does, an answer with a status and a body, a wait, a failure or another host. The parent
// reads a rule's line into these and writes them as a line, so the two never disagree on how a rule is written.
#import "Place.h"
#import "Window.h"
#import "Words.h"

/// The op's word for each choice, and none for the first: any method, and no failure.
static NSString *const kMethods[] = {@"", @"GET", @"POST", @"PUT", @"PATCH", @"DELETE"};
static NSString *const kFails[][2] = {
    {@"", @"No Failure"},
    {@"offline", @"Offline"},
    {@"timeout", @"Timeout"},
    {@"reset", @"Connection Lost"},
};
enum { kMethodCount = sizeof kMethods / sizeof kMethods[0],
       kFailCount = sizeof kFails / sizeof kFails[0] };

@interface MVNetworkRuleForm () <NSTextFieldDelegate>
@end

@implementation MVNetworkRuleForm {
  NSPopUpButton *_method, *_fail;
  NSDictionary<NSString *, NSTextField *> *_texts;
}

- (NSTextField *)field:(NSString *)name holding:(NSString *)placeholder called:(NSString *)label {
  NSTextField *field = MVSendField(name, placeholder, label, self, @selector(submitted:));
  field.delegate = self;
  field.usesSingleLineMode = YES;
  field.lineBreakMode = NSLineBreakByTruncatingTail;
  return field;
}

- (NSPopUpButton *)choice:(NSString *)name called:(NSString *)label {
  NSPopUpButton *choice = [NSPopUpButton new];
  choice.identifier = name;
  choice.accessibilityLabel = MVWord(label);
  choice.target = self;
  choice.action = @selector(edited:);
  return choice;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _method = [self choice:@"networkRuleMethod" called:@"Method"];
    [_method addItemWithTitle:MVWord(@"Any Method")];
    for (NSInteger i = 1; i < kMethodCount; i++) [_method addItemWithTitle:kMethods[i]];
    _fail = [self choice:@"networkRuleFail" called:@"Failure"];
    for (NSInteger i = 0; i < kFailCount; i++) [_fail addItemWithTitle:MVWord(kFails[i][1])];
    _texts = @{
      @"host": [self field:@"networkRuleHost" holding:@"api.example.com" called:@"Host"],
      @"path": [self field:@"networkRulePath" holding:@"/v1/items*" called:@"Path"],
      @"match": [self field:@"networkRuleMatch" holding:@"query=\"page=2\" has=name=Ada when=\"X-Api: 2*\"" called:@"Also Matches"],
      @"status": [self field:@"networkRuleStatus" holding:@"Status" called:@"Status"],
      @"delayMs": [self field:@"networkRuleDelay" holding:@"Delay in ms" called:@"Delay in ms"],
      @"body": [self field:@"networkRuleBody" holding:@"Body, or @file" called:@"Answer Body"],
      @"to": [self field:@"networkRuleTo" holding:@"Send to another host" called:@"Redirect"],
    };
    NSView * (^plate)(NSString *) = ^(NSString *key) {
      return MVFieldPlate(self->_texts[key], nil);
    };
    MVPaneFill(self, @[MVPaneRow(@[_method, plate(@"host"), plate(@"path")]), plate(@"match"), MVPaneRow(@[plate(@"status"), plate(@"delayMs"), _fail]), plate(@"body"), plate(@"to")], 6);
  }
  return self;
}

- (NSDictionary<NSString *, NSString *> *)fields {
  NSMutableDictionary<NSString *, NSString *> *fields = [NSMutableDictionary dictionary];
  [_texts enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSTextField *field, __unused BOOL *stop) {
    NSString *value = [field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (value.length) fields[key] = value;
  }];
  NSInteger method = _method.indexOfSelectedItem, fail = _fail.indexOfSelectedItem;
  if (method > 0 && method < kMethodCount) fields[@"method"] = kMethods[method];
  if (fail > 0 && fail < kFailCount) fields[@"fail"] = kFails[fail][0];
  return fields;
}

/// A rule's parts as the parent read them from its line; nil empties the fields.
- (void)show:(nullable NSDictionary *)fields {
  [_texts enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSTextField *field, __unused BOOL *stop) {
    field.stringValue = [fields[key] isKindOfClass:NSString.class] ? fields[key] : @"";
  }];
  NSInteger method = 0, fail = 0;
  for (NSInteger i = 1; i < kMethodCount; i++)
    if ([kMethods[i] isEqual:fields[@"method"]]) method = i;
  for (NSInteger i = 1; i < kFailCount; i++)
    if ([kFails[i][0] isEqual:fields[@"fail"]]) fail = i;
  [_method selectItemAtIndex:method];
  [_fail selectItemAtIndex:fail];
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self edited:nil];
}

- (void)edited:(id)sender {
  if (self.onEdit) self.onEdit();
}

- (void)submitted:(id)sender {
  if (self.onSubmit) self.onSubmit();
}

@end
