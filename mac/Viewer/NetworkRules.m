// The rules of the Network pane: what the probe answers, fails, delays or sends elsewhere in the app's requests, each
// as the line `capture_network` `mock` takes, so that an agent's rules and a person's are one list. A rule is added, changed,
// turned off and on, and removed here, by its line or by its fields; each change is of that one rule, by the name the
// parent told it by, so that a rule an agent set meanwhile stays as it is.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kListHeight = 96;

@interface MVNetworkRules () <NSTextFieldDelegate>
@end

@implementation MVNetworkRules {
  NSTextField *_field, *_about, *_moved;
  NSButton *_save, *_remove, *_switch, *_strict, *_unmatched;
  MVAccentButton *_byFields;
  MVNetworkRuleForm *_form;
  MVList *_list;
  NSArray<NSDictionary *> *_rules;
  /// The fields were changed last, and are what Save sends: the line is, once it is typed in.
  BOOL _fromFields;
  /// A change went from here, and the list that comes next is its own doing.
  BOOL _sent;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rules = @[];
    _field = MVSendField(@"networkRule", @"api.example.com/items* status=503 body=\"{}\"", @"Rule", self, @selector(save:));
    _field.usesSingleLineMode = YES;
    _field.lineBreakMode = NSLineBreakByTruncatingTail;
    _field.delegate = self;
    _save = MVPlaceButton(@"Add Rule", @"networkRuleSave", self, @selector(save:));
    _switch = MVPlaceButton(@"Turn Off", @"networkRuleSwitch", self, @selector(switchRule:));
    _remove = MVPlaceButton(@"Remove", @"networkRuleRemove", self, @selector(removeRule:));
    _byFields = (MVAccentButton *)MVPlaceButton(@"Fields", @"networkRuleFields", self, @selector(showFields:));
    _form = [MVNetworkRuleForm new];
    _form.hidden = YES;
    _strict = [NSButton checkboxWithTitle:MVWord(@"Fail an action when a request fails") target:self action:@selector(keep:)];
    _strict.identifier = @"networkStrict";
    _unmatched = [NSButton checkboxWithTitle:MVWord(@"Fail requests no rule takes") target:self action:@selector(keep:)];
    _unmatched.identifier = @"networkUnmatched";
    _list = [MVList new];
    _list.accessibilityLabel = MVWord(@"Rules");
    [_list.heightAnchor constraintEqualToConstant:kListHeight].active = YES;
    __weak MVNetworkRules *weak = self;
    _list.onSelect = ^(__unused MVRow *row) {
      [weak chosen];
    };
    _form.onEdit = ^{
      [weak edited:YES];
    };
    _form.onSubmit = ^{
      [weak save:nil];
    };
    _about = MVPaneNote(@"A rule is a host and a path, where * is any run of characters, then what it does: status= and body= for an answer of its own, fail=offline, to= another host, or delayMs=. It holds for the app's own requests until the capture stops.");
    _about.maximumNumberOfLines = 0;
    _moved = MVPaneNote(@"This rule was changed elsewhere. What you typed is kept: add it again, or leave it.");
    _moved.maximumNumberOfLines = 0;
    _moved.hidden = YES;
    MVPaneFill(self, @[_list, _moved, MVFieldPlate(_field, nil), _form, MVPaneRow(@[_save, _switch, _remove, _byFields]), _strict, _unmatched, _about], 6);
    [self chosen];
  }
  return self;
}

/// The rule chosen, where one is: its place in the list, by its name.
- (NSInteger)at {
  NSString *key = _list.selected.key;
  NSUInteger at = key ? [_rules indexOfObjectPassingTest:^BOOL(NSDictionary *rule, __unused NSUInteger i, __unused BOOL *stop) {
    return [rule[@"id"] isEqual:key];
  }]
                      : NSNotFound;
  return at == NSNotFound ? -1 : (NSInteger)at;
}

/// The name of the rule chosen, as the parent told it.
- (nullable NSString *)chosenId {
  NSInteger at = self.at;
  return at < 0 ? nil : _rules[(NSUInteger)at][@"id"];
}

/// A rule chosen stands in the field to be changed, and the buttons say what they would do to it.
- (void)chosen {
  NSInteger at = self.at;
  NSDictionary *rule = at >= 0 && at < (NSInteger)_rules.count ? _rules[(NSUInteger)at] : nil;
  if (rule) _field.stringValue = [rule[@"rule"] description];
  if (rule) [_form show:[rule[@"fields"] isKindOfClass:NSDictionary.class] ? rule[@"fields"] : nil];
  _fromFields = NO;
  _save.title = MVWord(rule ? @"Save Rule" : @"Add Rule");
  _switch.title = MVWord([rule[@"off"] boolValue] ? @"Turn On" : @"Turn Off");
  _switch.enabled = _remove.enabled = rule != nil;
  _list.hidden = !_rules.count;
}

/// The parent's rules, each with what it took: the one chosen stays chosen as they are read again.
- (void)show:(NSArray<NSDictionary *> *)rules {
  NSString *chosen = _list.selected.key;
  // the rule a person has in the field is gone from the list: its words stay, to be added again or left
  BOOL had = chosen && [[_rules valueForKey:@"id"] containsObject:chosen];
  _moved.hidden = !(had && ![[rules valueForKey:@"id"] containsObject:chosen] && !_sent);
  _sent = NO;
  _rules = rules;
  NSMutableArray<MVRow *> *rows = [NSMutableArray array];
  [rules enumerateObjectsUsingBlock:^(NSDictionary *rule, NSUInteger at, __unused BOOL *stop) {
    MVRow *row = [MVRow new];
    BOOL off = [rule[@"off"] boolValue];
    row.key = [rule[@"id"] isKindOfClass:NSString.class] ? rule[@"id"] : @(at).stringValue;
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

- (void)fill:(NSString *)line fields:(nullable NSDictionary *)fields {
  [_list selectKey:nil];
  [self chosen];
  _field.stringValue = line;
  [_form show:fields];
}

- (void)showStrict:(BOOL)strict unmatched:(BOOL)fails {
  _strict.state = strict ? NSControlStateValueOn : NSControlStateValueOff;
  _unmatched.state = fails ? NSControlStateValueOn : NSControlStateValueOff;
}

/// The fields beside the line, or the words about a rule's line in their place: both leave the list no room.
- (void)showFields:(id)sender {
  _form.hidden = !_form.hidden;
  _about.hidden = !_form.hidden;
  _byFields.hue = _form.hidden ? nil : MVAccent();
  _byFields.accessibilityValue = _form.hidden ? nil : MVWord(@"selected");
}

/// Which of the two a person changed last is what Save sends.
- (void)edited:(BOOL)fields {
  _fromFields = fields;
}

- (void)controlTextDidChange:(NSNotification *)note {
  [self edited:NO];
}

/// Each is the capture's, set by the op an agent sets it by.
- (void)keep:(NSButton *)sender {
  if (!self.onSend) return;
  if (sender == _strict) self.onSend(@{@"op": @"control", @"name": @"networkKeep", @"strict": @(sender.state == NSControlStateValueOn)});
  else self.onSend(@{@"op": @"control", @"name": @"networkKeep", @"unmatched": sender.state == NSControlStateValueOn ? @"fail" : @"pass"});
}

/// One change of one rule: the parent makes it in the list as it stands then, by the op an agent calls.
- (void)send:(NSString *)name with:(NSDictionary *)more {
  if (!self.onSend) return;
  NSMutableDictionary *m = [@{@"op": @"control", @"name": name} mutableCopy];
  [m addEntriesFromDictionary:more];
  _sent = YES;
  _moved.hidden = YES;
  self.onSend(m);
}

/// The field's line in place of the rule chosen, by its name, or a new rule where none is; the fields in its place
/// where they were changed last, which the parent writes as a line.
- (void)save:(id)sender {
  NSString *chosen = self.chosenId;
  NSMutableDictionary *more = [NSMutableDictionary dictionary];
  if (chosen) more[@"id"] = chosen;
  if (_fromFields && !_form.hidden) {
    NSDictionary *fields = _form.fields;
    if (!fields.count) return;
    more[@"fields"] = fields;
    [_form show:nil];
  } else {
    NSString *line = [_field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!line.length) return;
    more[@"rule"] = line;
  }
  _field.stringValue = @"";
  [_list selectKey:nil];
  [self send:@"networkRuleSave" with:more];
}

- (void)removeRule:(id)sender {
  NSString *chosen = self.chosenId;
  if (!chosen) return;
  _field.stringValue = @"";
  [_list selectKey:nil];
  [self send:@"networkRuleRemove" with:@{@"id": chosen}];
}

/// On or off: the parent writes the rule's line again with the word, as it reads the line.
- (void)switchRule:(id)sender {
  NSInteger at = self.at;
  NSString *chosen = self.chosenId;
  if (!chosen) return;
  [self send:@"networkRuleSwitch" with:@{@"id": chosen, @"on": @([_rules[(NSUInteger)at][@"off"] boolValue])}];
}

- (BOOL)moved {
  return !_moved.hidden;
}

- (NSArray<MVRow *> *)rows {
  return _list.rows;
}

- (MVNetworkRuleForm *)form {
  return _form;
}

@end
