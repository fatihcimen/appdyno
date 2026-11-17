// The rules of the Network pane: what the probe answers, fails, delays or sends elsewhere in the app's requests. Each
// reads as a sentence, what it takes and then what it does, with a switch and how many requests it took; one chosen, or
// a new one, is written under the list in fields with names, and its line beside them. Every change is of that one
// rule, by the name the parent told it by, so that a rule an agent set meanwhile stays as it is, and one that went from
// under a person is said to have.
#import "Place.h"
#import "Window.h"
#import "Words.h"

static const double kRowHigh = 40, kListMost = 3.5;

NSString *MVNetworkRuleSentence(NSDictionary *rule) {
  NSDictionary *f = [rule[@"fields"] isKindOfClass:NSDictionary.class] ? rule[@"fields"] : nil;
  // a line the parent could read no parts of stands as it is
  if (!f.count) return [rule[@"rule"] description] ?: @"";
  NSMutableArray<NSString *> *does = [NSMutableArray array];
  if ([f[@"fail"] length]) [does addObject:MVNetworkFailWord(f[@"fail"])];
  if ([f[@"to"] length]) [does addObject:f[@"to"]];
  if ([f[@"status"] length]) [does addObject:f[@"status"]];
  if ([f[@"body"] length]) [does addObject:[f[@"body"] length] > 24 ? [[f[@"body"] substringToIndex:23] stringByAppendingString:@"…"] : f[@"body"]];
  if ([f[@"delayMs"] length]) [does addObject:MVFormat(@"after %@", @[MVNetworkTook([f[@"delayMs"] doubleValue])])];
  NSString *takes = [NSString stringWithFormat:@"%@%@%@", [f[@"method"] length] ? [f[@"method"] stringByAppendingString:@" "] : @"", f[@"host"] ?: @"", f[@"path"] ?: @""];
  if ([f[@"match"] length]) takes = [NSString stringWithFormat:@"%@ %@", takes, f[@"match"]];
  return does.count ? [NSString stringWithFormat:@"%@ → %@", takes, [does componentsJoinedByString:@" "]] : takes;
}

/// The mark of what a rule does, as the mark of a request it took: a rule's own doing in every case.
static NSString *markOf(NSDictionary *rule) {
  NSDictionary *f = [rule[@"fields"] isKindOfClass:NSDictionary.class] ? rule[@"fields"] : @{};
  if ([f[@"fail"] length]) return @"xmark.diamond.fill";
  return @"arrow.triangle.turn.up.right.diamond.fill";
}

/// What a row of the list asks of the list it stands in.
@interface MVNetworkRules (Rows)
- (void)opened:(NSButton *)sender;
- (void)switched:(NSSwitch *)sender;
@end

/// One rule of the list: its sentence, what it took, and its switch. A click on its words opens it to be changed.
@interface MVRuleRow : NSView
@property(nonatomic, readonly) NSButton *open;
@property(nonatomic, readonly) NSSwitch *on;
@property(nonatomic) BOOL chosen;
@end

@implementation MVRuleRow

- (instancetype)initWithRule:(NSDictionary *)rule at:(NSUInteger)at target:(id)target {
  if ((self = [super initWithFrame:NSZeroRect])) {
    BOOL off = [rule[@"off"] boolValue];
    MVInk *mark = [[MVInk alloc] initWithSymbol:markOf(rule) color:off ? MVQuietColor() : MVAgent() size:13];
    NSTextField *says = MVContentText(MVNetworkRuleSentence(rule), MVStyleBody);
    says.lineBreakMode = NSLineBreakByTruncatingMiddle;
    says.toolTip = [rule[@"rule"] description];
    NSString *taken = MVFormat([rule[@"hits"] integerValue] == 1 ? @"took %@ request" : @"took %@ requests", @[MVCount([rule[@"hits"] unsignedIntegerValue])]);
    NSTextField *took = MVContentText(off ? [NSString stringWithFormat:@"%@ · %@", MVWord(@"Off"), taken] : taken, MVStyleSub);
    NSStackView *lines = MVPaneStack(@[says, took], 1);
    // as wide as the row leaves it, and no narrower for the words being short
    [lines setHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    for (NSTextField *line in @[says, took]) [line setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    _on = [NSSwitch new];
    _on.controlSize = NSControlSizeMini;
    _on.state = off ? NSControlStateValueOff : NSControlStateValueOn;
    _on.identifier = [NSString stringWithFormat:@"networkRuleOn.%lu", (unsigned long)at];
    _on.tag = (NSInteger)at;
    _on.target = target;
    _on.action = @selector(switched:);
    _on.accessibilityLabel = says.stringValue;
    // the whole of its words is what is pressed, under them: a real click finds it by its place in the list
    _open = [MVBarButton buttonWithTitle:@"" target:target action:@selector(opened:)];
    _open.identifier = [NSString stringWithFormat:@"networkRule.%lu", (unsigned long)at];
    _open.tag = (NSInteger)at;
    _open.bordered = NO;
    _open.transparent = YES;
    _open.accessibilityLabel = [NSString stringWithFormat:@"%@, %@", says.stringValue, took.stringValue];
    // the open button lies over the words, so a click on them is its click whichever way a label answers hit testing
    for (NSView *part in @[mark, lines, _open, _on]) {
      part.translatesAutoresizingMaskIntoConstraints = NO;
      [self addSubview:part];
    }
    [NSLayoutConstraint activateConstraints:@[
      [self.heightAnchor constraintEqualToConstant:kRowHigh],
      [mark.centerXAnchor constraintEqualToAnchor:self.leadingAnchor
                                         constant:17],
      [mark.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
      [mark.widthAnchor constraintEqualToConstant:14],
      [mark.heightAnchor constraintEqualToConstant:14],
      [lines.leadingAnchor constraintEqualToAnchor:self.leadingAnchor
                                          constant:30],
      [lines.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
      [lines.trailingAnchor constraintEqualToAnchor:_on.leadingAnchor
                                           constant:-8],
      [_on.trailingAnchor constraintEqualToAnchor:self.trailingAnchor
                                         constant:-12],
      [_on.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
      [_open.topAnchor constraintEqualToAnchor:self.topAnchor],
      [_open.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
      [_open.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
      [_open.trailingAnchor constraintEqualToAnchor:_on.leadingAnchor
                                           constant:-4],
    ]];
  }
  return self;
}

- (void)setChosen:(BOOL)chosen {
  _chosen = chosen;
  self.needsDisplay = YES;
}

/// The one open under the list wears the house's mark of what is chosen.
- (void)drawRect:(NSRect)dirty {
  if (!_chosen) return;
  NSRect pill = NSInsetRect(self.bounds, 4, 1);
  [[MVAccent() colorWithAlphaComponent:0.2] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:pill xRadius:10 yRadius:10] fill];
}

@end

/// What scrolls in it starts at its top, as a page does.
@interface MVTopClip : NSClipView
@end

@implementation MVTopClip
- (BOOL)isFlipped {
  return YES;
}
@end

/// A column that scrolls where it has not the room to stand whole: as wide as what it stands in, from its top.
static NSScrollView *scrolling(NSView *column) {
  NSScrollView *scroll = [NSScrollView new];
  scroll.contentView = [MVTopClip new];
  scroll.drawsBackground = scroll.contentView.drawsBackground = NO;
  scroll.hasVerticalScroller = YES;
  scroll.autohidesScrollers = YES;
  column.translatesAutoresizingMaskIntoConstraints = NO;
  scroll.documentView = column;
  [NSLayoutConstraint activateConstraints:@[
    [column.topAnchor constraintEqualToAnchor:scroll.contentView.topAnchor],
    [column.leadingAnchor constraintEqualToAnchor:scroll.contentView.leadingAnchor],
    [column.trailingAnchor constraintEqualToAnchor:scroll.contentView.trailingAnchor],
  ]];
  return scroll;
}

@implementation MVNetworkRules {
  NSStackView *_rows;
  NSScrollView *_scroll;
  NSView *_listCard, *_none, *_editCard, *_keeps;
  NSLayoutConstraint *_listHigh;
  NSScrollView *_formScroll;
  NSView *_slack;
  NSButton *_new, *_save, *_remove, *_cancel, *_strict, *_unmatched;
  NSTextField *_moved, *_editTitle;
  MVNetworkRuleForm *_form;
  NSArray<NSDictionary *> *_rules;
  /// The rule open under the list, by its name; none while a new one is written. And whether anything is open.
  NSString *_openId;
  BOOL _editing;
  /// A change went from here, and the list that comes next is its own doing.
  BOOL _sent;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _rules = @[];
    _rows = [NSStackView stackViewWithViews:@[]];
    _rows.orientation = NSUserInterfaceLayoutOrientationVertical;
    _rows.alignment = NSLayoutAttributeWidth;
    _rows.spacing = 0;
    _scroll = scrolling(_rows);
    _listCard = MVCardInset(_scroll, 4, 0);
    _listHigh = [_scroll.heightAnchor constraintEqualToConstant:kRowHigh];
    _listHigh.active = YES;
    _none = MVEmptyCard(@"arrow.triangle.turn.up.right.diamond", @"No rules. A rule answers, fails, delays or sends elsewhere the app's requests that fit it, until the capture stops.");
    _new = MVPlaceButton(@"New Rule", @"networkRuleNew", self, @selector(newRule:));
    _editTitle = MVText(@"New Rule", MVStyleStrong);
    _form = [MVNetworkRuleForm new];
    __weak MVNetworkRules *weak = self;
    _form.onSubmit = ^{
      [weak save:nil];
    };
    _moved = MVPaneNote(@"This rule was changed elsewhere. What you typed is kept: add it again, or leave it.");
    _moved.maximumNumberOfLines = 0;
    // as wide as the card it stands in lets it be, so that its last words are not cut
    _moved.preferredMaxLayoutWidth = MVInspectorWidth - 2 * 16 - 2 * 14;
    _moved.textColor = MVInkColor();
    _moved.hidden = YES;
    _save = MVPlacePrimary(@"Add", @"networkRuleSave", self, @selector(save:));
    _remove = MVPlaceButton(@"Remove", @"networkRuleRemove", self, @selector(removeRule:));
    _cancel = MVPlaceButton(@"Cancel", @"networkRuleCancel", self, @selector(cancel:));
    NSStackView *buttons = [NSStackView stackViewWithViews:@[_save, _cancel, [NSView new], _remove]];
    buttons.spacing = 6;
    // the fields scroll where the pane is too short for them all, and the buttons under them stay in sight
    _formScroll = scrolling(_form);
    [_formScroll setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    [_formScroll setContentCompressionResistancePriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSLayoutConstraint *whole = [_formScroll.heightAnchor constraintEqualToAnchor:_form.heightAnchor];
    whole.priority = NSLayoutPriorityDefaultLow;
    whole.active = YES;
    _editCard = MVCard(MVPaneStack(@[_editTitle, _moved, _formScroll, buttons], 10), 12);
    _editCard.hidden = YES;
    _strict = [NSButton checkboxWithTitle:MVWord(@"Fail an action when a request fails") target:self action:@selector(keep:)];
    _strict.identifier = @"networkStrict";
    _unmatched = [NSButton checkboxWithTitle:MVWord(@"Fail requests no rule takes") target:self action:@selector(keep:)];
    _unmatched.identifier = @"networkUnmatched";
    // neither makes the pane wider than it is, whatever its language
    for (NSButton *box in @[_strict, _unmatched]) [box setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    _strict.toolTip = MVWord(@"An AI client's action fails when a request of the app got a 5xx or failed on its way, unless a rule made it.");
    _unmatched.toolTip = MVWord(@"A request of the app that no rule takes fails, as with no network: nothing leaves the device unseen.");
    // from one left edge, which a box keeps by its own measure and not by its frame
    NSStackView *keeps = [NSStackView stackViewWithViews:@[MVPaneHeading(@"When a Request Fails"), _strict, _unmatched]];
    keeps.orientation = NSUserInterfaceLayoutOrientationVertical;
    keeps.alignment = NSLayoutAttributeLeading;
    keeps.spacing = 6;
    _keeps = keeps;
    _slack = [NSView new];
    [_slack setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationVertical];
    NSStackView *column = MVPaneFill(self, @[_listCard, _none, [NSStackView stackViewWithViews:@[_new, [NSView new]]], _editCard, _keeps, _slack], 8);
    // each part is as wide as the section, whatever it holds
    for (NSView *part in @[_listCard, _none, _editCard, _keeps]) [part.widthAnchor constraintEqualToAnchor:column.widthAnchor].active = YES;
    [self lay];
  }
  return self;
}

- (NSUInteger)openAt {
  return _openId ? [[_rules valueForKey:@"id"] indexOfObject:_openId] : NSNotFound;
}

/// What shows of the list and of the rule open under it.
- (void)lay {
  NSUInteger at = self.openAt;
  _listCard.hidden = !_rules.count;
  _none.hidden = _rules.count || _editing;
  _listHigh.constant = MIN((double)_rules.count, kListMost) * kRowHigh;
  _new.hidden = _editing;
  _editCard.hidden = !_editing;
  // a rule being written has the room: what the capture holds beside its rules comes back as it closes
  _keeps.hidden = _slack.hidden = _editing;
  _editTitle.stringValue = MVWord(at == NSNotFound ? @"New Rule" : @"Change This Rule");
  _save.title = MVWord(at == NSNotFound ? @"Add" : @"Save");
  _remove.hidden = at == NSNotFound;
  [_rows.arrangedSubviews enumerateObjectsUsingBlock:^(MVRuleRow *row, NSUInteger i, __unused BOOL *stop) {
    row.chosen = i == at;
  }];
}

/// The parent's rules, each with what it took: the one open stays open as they are read again, with what a person has
/// typed in it; one that went from the list by another's doing is said to have, and what was typed is kept to add again.
- (void)show:(NSArray<NSDictionary *> *)rules {
  BOOL had = self.openAt != NSNotFound;
  _rules = rules;
  for (NSView *old in _rows.arrangedSubviews.copy) [old removeFromSuperview];
  [rules enumerateObjectsUsingBlock:^(NSDictionary *rule, NSUInteger at, __unused BOOL *stop) {
    MVRuleRow *row = [[MVRuleRow alloc] initWithRule:rule at:at target:self];
    [self->_rows addArrangedSubview:row];
    // as wide as the list, its words taking what its mark and its switch leave
    [row.widthAnchor constraintEqualToAnchor:self->_rows.widthAnchor].active = YES;
  }];
  if (had && self.openAt == NSNotFound) {
    _moved.hidden = _sent;
    _openId = nil;
    if (_sent) _editing = NO;
  }
  _sent = NO;
  [self lay];
}

- (void)edit:(nullable NSDictionary *)rule {
  _openId = [rule[@"id"] isKindOfClass:NSString.class] ? rule[@"id"] : nil;
  _editing = YES;
  _moved.hidden = YES;
  [_form show:[rule[@"fields"] isKindOfClass:NSDictionary.class] ? rule[@"fields"] : nil line:[rule[@"rule"] description]];
  // from its first field, wherever the one before it was left
  [_formScroll.contentView scrollToPoint:NSZeroPoint];
  [_formScroll reflectScrolledClipView:_formScroll.contentView];
  [self lay];
}

- (void)opened:(NSButton *)sender {
  if (sender.tag >= 0 && sender.tag < (NSInteger)_rules.count) [self edit:_rules[(NSUInteger)sender.tag]];
}

- (void)newRule:(id)sender {
  [self edit:nil];
}

- (void)cancel:(id)sender {
  _editing = NO;
  _openId = nil;
  _fromRequest = NO;
  [self lay];
}

- (void)fill:(NSString *)line fields:(nullable NSDictionary *)fields {
  [self edit:@{@"rule": line, @"fields": fields ?: @{}}];
  _fromRequest = YES;
}

- (void)showStrict:(BOOL)strict unmatched:(BOOL)fails {
  _strict.state = strict ? NSControlStateValueOn : NSControlStateValueOff;
  _unmatched.state = fails ? NSControlStateValueOn : NSControlStateValueOff;
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

/// The rule open, saved in its place by its name, or added where it is new: by its line where that was typed last, else
/// by its fields, which the parent writes as a line.
- (void)save:(id)sender {
  if (!_editing) return;
  NSMutableDictionary *more = [NSMutableDictionary dictionary];
  if (_openId) more[@"id"] = _openId;
  if (_form.typed && _form.line.length) more[@"rule"] = _form.line;
  else if (_form.fields.count) more[@"fields"] = _form.fields;
  else return;
  BOOL back = _fromRequest;
  [self cancel:nil];
  [self send:@"networkRuleSave" with:more];
  if (back && self.onDone) self.onDone();
}

- (void)removeRule:(id)sender {
  NSString *open = _openId;
  if (!open) return;
  [self cancel:nil];
  [self send:@"networkRuleRemove" with:@{@"id": open}];
}

/// On or off, without opening it: the parent writes the rule's line again with the word.
- (void)switched:(NSSwitch *)sender {
  if (sender.tag < 0 || sender.tag >= (NSInteger)_rules.count) return;
  NSString *name = _rules[(NSUInteger)sender.tag][@"id"];
  if (name) [self send:@"networkRuleSwitch" with:@{@"id": name, @"on": @(sender.state == NSControlStateValueOn)}];
}

- (NSUInteger)count {
  return _rules.count;
}

- (NSArray<NSString *> *)says {
  NSMutableArray<NSString *> *says = [NSMutableArray array];
  for (MVRuleRow *row in _rows.arrangedSubviews) [says addObject:row.open.accessibilityLabel];
  return says;
}

- (BOOL)moved {
  return !_moved.hidden && _editing;
}

- (BOOL)editing {
  return _editing;
}

- (MVNetworkRuleForm *)form {
  return _form;
}

@end
