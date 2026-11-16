// The rules of the Network pane: what the probe answers, fails, delays or sends elsewhere in the app's requests, each
// as the line `network` `mock` takes, so that an agent's rules and a person's are one list. A rule is added, changed,
// turned off and on, and removed here; each change is that op's, through the parent.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kListHeight = 96;

@implementation MVNetworkRules {
  NSTextField *_field;
  NSButton *_save, *_remove, *_switch;
  MVList *_list;
  NSArray<NSDictionary *> *_rules;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rules = @[];
    _field = MVSendField(@"networkRule", @"api.example.com/items* status=503 body=\"{}\"", @"Rule", self, @selector(save:));
    _field.usesSingleLineMode = YES;
    _field.lineBreakMode = NSLineBreakByTruncatingTail;
    _save = MVPlaceButton(@"Add Rule", @"networkRuleSave", self, @selector(save:));
    _switch = MVPlaceButton(@"Turn Off", @"networkRuleSwitch", self, @selector(switchRule:));
    _remove = MVPlaceButton(@"Remove", @"networkRuleRemove", self, @selector(removeRule:));
    _list = [MVList new];
    _list.accessibilityLabel = MVWord(@"Rules");
    [_list.heightAnchor constraintEqualToConstant:kListHeight].active = YES;
    __weak MVNetworkRules *weak = self;
    _list.onSelect = ^(__unused MVRow *row) {
      [weak chosen];
    };
    NSTextField *about = MVPaneNote(@"A rule is a host and a path, where * is any run of characters, then what it does: status= and body= for an answer of its own, fail=offline, to= another host, or delayMs=. It holds for the app's own requests until the capture stops.");
    about.maximumNumberOfLines = 0;
    MVPaneFill(self, @[_list, MVFieldPlate(_field, nil), MVPaneRow(@[_save, _switch, _remove]), about], 6);
    [self chosen];
  }
  return self;
}

/// The rule chosen, where one is: its place in the list.
- (NSInteger)at {
  NSString *key = _list.selected.key;
  return key ? key.integerValue : -1;
}

/// A rule chosen stands in the field to be changed, and the buttons say what they would do to it.
- (void)chosen {
  NSInteger at = self.at;
  NSDictionary *rule = at >= 0 && at < (NSInteger)_rules.count ? _rules[(NSUInteger)at] : nil;
  if (rule) _field.stringValue = [rule[@"rule"] description];
  _save.title = MVWord(rule ? @"Save Rule" : @"Add Rule");
  _switch.title = MVWord([rule[@"off"] boolValue] ? @"Turn On" : @"Turn Off");
  _switch.enabled = _remove.enabled = rule != nil;
  _list.hidden = !_rules.count;
}

/// The parent's rules, each with what it took: the one chosen stays chosen as they are read again.
- (void)show:(NSArray<NSDictionary *> *)rules {
  NSString *chosen = _list.selected.key;
  _rules = rules;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [rules enumerateObjectsUsingBlock:^(NSDictionary *rule, NSUInteger at, __unused BOOL *stop) {
    MVRow *row = [MVRow new];
    BOOL off = [rule[@"off"] boolValue];
    row.key = @(at).stringValue;
    row.title = [rule[@"rule"] description];
    row.help = row.title;
    NSString *taken = MVFormat(@"%@ taken", @[[rule[@"hits"] description] ?: @"0"]);
    row.detail = off ? [NSString stringWithFormat:@"%@ · %@", MVWord(@"Off"), taken] : taken;
    row.symbol = off ? @"circle" : @"checkmark.circle.fill";
    if (!off) row.tint = MVGreen();
    [rows addObject:row];
  }];
  _list.rows = rows;
  [_list selectKey:chosen];
  [self chosen];
}

/// The whole list as it would stand, sent as one: the parent sets it by the op an agent calls.
- (void)send:(NSArray<NSString *> *)lines {
  if (self.onSend) self.onSend(@{@"op": @"control", @"name": @"networkRules", @"rules": lines});
}

- (NSMutableArray<NSString *> *)lines {
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (NSDictionary *rule in _rules) [lines addObject:[rule[@"rule"] description]];
  return lines;
}

/// The field's line in place of the rule chosen, or after the rest where none is.
- (void)save:(id)sender {
  NSString *line = [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!line.length) return;
  NSMutableArray<NSString *> *lines = self.lines;
  NSInteger at = self.at;
  if (at >= 0 && at < (NSInteger)lines.count) lines[(NSUInteger)at] = line;
  else [lines addObject:line];
  _field.stringValue = @"";
  [_list selectKey:nil];
  [self send:lines];
}

- (void)removeRule:(id)sender {
  NSMutableArray<NSString *> *lines = self.lines;
  NSInteger at = self.at;
  if (at < 0 || at >= (NSInteger)lines.count) return;
  [lines removeObjectAtIndex:(NSUInteger)at];
  _field.stringValue = @"";
  [_list selectKey:nil];
  [self send:lines];
}

/// On or off: the parent writes the rule's line again with the word, as it reads the line.
- (void)switchRule:(id)sender {
  NSInteger at = self.at;
  if (at < 0 || at >= (NSInteger)_rules.count || !self.onSend) return;
  self.onSend(@{@"op": @"control", @"name": @"networkRuleSwitch", @"at": @(at), @"on": @([_rules[(NSUInteger)at][@"off"] boolValue])});
}

- (NSArray<MVRow *> *)rows {
  return _list.rows;
}

@end
